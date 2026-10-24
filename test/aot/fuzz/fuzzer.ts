// The driver: draws programs from the sources, has a bed judge them, and turns each difference into a stored finding: confirmed,
// reduced, attributed to a pass or a flow result, and told apart from those that are there already.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from "fs";
import { join } from "path";
import { isFinding, sameFailure, type Bed, type Failure, type Judged, type Mode, type Program, type Verdict } from "./beds";
import { parses, reprinted } from "./mutate";
import { Random } from "./random";
import { reduce, shape } from "./reduce";
import { allSources, type Generated } from "./sources";
import { typeChecker, type Checker } from "./type-check";

export interface Settings {
  beds: { bed: Bed; jobs: number }[];
  out: string;
  work: string;
  programsRoot: string;
  seconds: number;
  /** Stops after this many programs, if given. */
  programs?: number;
  firstSeed: number;
  sources?: string[];
  /** Files of `<regex>\t<owner>\t<why>[\t<finding | reduced | both | program>]`: see accepted-differences.tsv. */
  known: string[];
  minFreeBytes: number;
  reduceSeconds: number;
  /** Whether to look for the switches without which a finding goes away, which takes a dozen builds or more. Default: yes. */
  attribute?: boolean;
  /** The largest number of programs in one build. */
  batch?: number;
  /** Failures are listed in failures.tsv and counted, and nothing is confirmed, reduced or stored. */
  isCountOnly?: boolean;
}

export interface Summary {
  programs: number;
  findings: number;
  distinct: string[];
  status: string;
}

interface Known {
  pattern: RegExp;
  owner: string;
  why: string;
  /** What the pattern is matched against: the words of the finding, the text of the reduced program, both, or the text of a program before it is run. */
  where: string;
  count: number;
}

export async function fuzz(settings: Settings): Promise<Summary> {
  const { out, work, beds } = settings;
  const started = Date.now();
  const deadline = started + settings.seconds * 1000;
  // Behind the deadline every worker ends the batch it has begun, and what fails there is looked at too: a later run has other seeds. But a shared build under a sanitizer takes minutes, so that work has a bound of its own:
  // a few failures are confirmed, and from the last call on nothing is built again. What is never the load's doing is then stored as it was drawn, the rest is listed.
  const lastCall = deadline + Math.min(300, settings.seconds / 3) * 1000;
  const confirmedBehindTheDeadline = 4;
  let lateLooks = 0;
  for (const { bed } of beds) bed.lastCall = lastCall;
  mkdirSync(join(out, "findings"), { recursive: true });
  mkdirSync(work, { recursive: true });

  const rejected = new Set<string>();
  const sources = await allSources(settings.programsRoot, rejected);
  const wanted = (settings.sources ?? Object.keys(sources)).filter(name => sources[name]);
  if (!wanted.length) throw new Error("no source of programs");

  const known: Known[] = [];
  for (const file of settings.known) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const [pattern, owner, why, where = "finding"] = line.split("\t");
      if (line.startsWith("#") || why === undefined) continue;
      known.push({ pattern: new RegExp(pattern), owner, why, where, count: 0 });
    }
  }
  const described = (bed: Bed, mode: string, failure: Failure, group?: string) => `${bed.name} ${mode} ${failure.kind} ${failure.detail}${group ? ` | ${group}` : ""}`;
  const knownAs = (bed: Bed, mode: string, failure: Failure, group?: string) => known.find(entry => entry.where === "finding" && entry.pattern.test(described(bed, mode, failure, group)));
  const knownText = (where: "reduced" | "program", text: string) => known.find(entry => entry.where === where && entry.pattern.test(text));
  // A line that looks at the text of a program alone says where an executable may answer otherwise than plain Bun. It excuses no build that runs out of its clock and nothing that ends by a signal, whatever the program holds.
  const isNeverByDesign = (kind: string) => ["build hang", "build crash", "internal compiler error", "crash", "hang"].includes(kind);
  // Load makes a slow run look like one that never ends. It ends nothing by a signal and puts no message into the compiler's mouth.
  const isNeverTheLoad = (kind: string) => ["build crash", "internal compiler error", "crash"].includes(kind);

  const counts = { programs: {} as Record<string, number>, runs: {} as Record<string, number>, skipped: {} as Record<string, number>, findings: 0, known: 0, repeated: 0, unstable: 0, onlyTogether: 0, artifacts: 0, reductions: 0, notConfirmed: 0 };
  const distinct: string[] = [];
  /** Group, then "programs", "<mode> same" or "<mode> <kind of failure>". */
  const groups = new Map<string, Record<string, number>>();
  const inGroup = (generated: Generated, what: string) => generated.group && bump(groups.get(generated.group) ?? groups.set(generated.group, {}).get(generated.group)!, what);
  let checker: Checker | undefined | "not asked" = "not asked";
  const bump = (table: Record<string, number>, key: string, by = 1) => (table[key] = (table[key] ?? 0) + by);
  const listed = (entries: Record<string, number>) => Object.entries(entries).sort().map(([key, count]) => `${key} ${count}`).join(", "); // prettier-ignore
  const total = () => Object.values(counts.programs).reduce((sum, count) => sum + count, 0);

  const status = (state: string) => {
    const hours = (Date.now() - started) / 3_600_000;
    const rate = beds.map(({ bed }) => `${bed.name} ${Math.round(Object.entries(counts.programs).filter(([key]) => key.startsWith(bed.name)).reduce((sum, [, count]) => sum + count, 0) / hours)}/h`).join(", ");
    return (
      `${new Date().toISOString().slice(0, 19)}Z ${state} | binaries ${beds.map(({ bed }) => bed.binary).join(", ")} | seeds ${settings.firstSeed}.. | programs ${total()} (${listed(counts.programs)}) | rate ${rate} | compiled runs: ${listed(counts.runs)} | skipped: ${listed(counts.skipped)} | ` +
      `findings ${counts.findings}: known ${counts.known}, repeated ${counts.repeated}, unstable ${counts.unstable}, only in a shared build ${counts.onlyTogether}, of the bed ${counts.artifacts}, not confirmed ${counts.notConfirmed}, distinct in this run ${distinct.length}, distinct stored ${readdirSync(join(out, "findings")).length} | reductions ${counts.reductions}\n`
    );
  };
  const writeStatus = (state = "running") => {
    writeFileSync(join(out, "status.txt"), status(state));
    if (groups.size) writeFileSync(join(out, "groups.tsv"), [...groups].sort().map(([group, table]) => `${group}\t${listed(table)}\n`).join("")); // prettier-ignore
    writeFileSync(join(out, "known-counts.txt"), known.filter(entry => entry.count).map(entry => `${entry.count}\t${entry.owner}\t${entry.pattern.source}\t${entry.why}\n`).join("")); // prettier-ignore
  };

  const baseIsSame = new Map<string, boolean>();
  /** How many failures of these words were looked at; without end once one of them is stored. */
  const seenEarly = new Map<string, number>();
  const perGroup = new Map<string, number>();
  let sequence = 0;

  const freeBytes = (path: string) => {
    const { bavail, bsize } = statfsSync(path);
    return Number(bavail) * Number(bsize);
  };
  const stopped = () => Date.now() > deadline || existsSync(join(out, "STOP")) || (settings.programs !== undefined && sequence >= settings.programs);

  const alone = async (bed: Bed, folder: string, program: Program, flags: string[]) => (await bed.judge(folder, [program], flags))[0];

  // Which switches make the failure go away. Where a build is cheap every switch is tried; else one is found by halving.
  async function guilty(bed: Bed, folder: string, program: Program, mode: Mode, failure: Failure): Promise<string[]> {
    // Another failure in its place does not clear a switch: a build may refuse the flags, or fail without the pass.
    const goesAway = async (flags: string[]) => (await alone(bed, folder, program, [...mode.flags, ...flags])).verdict.kind === "same";
    const { flowResults, passes } = await bed.switches();
    const found: string[] = [];
    const withoutFlow = await goesAway(bed.withoutFlowResults);
    if (withoutFlow) found.push("flow-results");
    if (bed.batch === 1) {
      for (const name of withoutFlow ? [...flowResults, ...passes] : passes) if (await goesAway(bed.disabling([name]))) found.push(name);
      return found;
    }
    for (let names of withoutFlow ? [flowResults, passes] : [passes]) {
      if (names !== flowResults && !(await goesAway(bed.disabling(names)))) continue;
      while (names.length > 1) {
        const [first, second] = [names.slice(0, names.length >> 1), names.slice(names.length >> 1)];
        if (await goesAway(bed.disabling(first))) names = first;
        else if (await goesAway(bed.disabling(second))) names = second;
        else break;
      }
      found.push(names.length <= 4 ? names.join("&") : `${names.length} of them together`);
    }
    return found;
  }

  // A failure that needs the other programs of its build: what the compiler proves, it proves about all of them at once.
  // The companions that are not needed go first, then what can go of the program itself. Every attempt is a build of its own.
  async function keepTogether(bed: Bed, folder: string, generated: Generated, members: Generated[], mode: Mode, failure: Failure) {
    if (!bed.store) return;
    // An empty module keeps the build a shared one when no companion is left.
    const filler: Program = { text: "", extension: "js" };
    const failsWith = async (program: Program, others: Program[]) => sameFailure(failure, (await bed.judge(folder, [program, filler, ...others], mode.flags))[0].verdict);
    let others: Program[] = members.filter(each => each !== generated).map(({ text, extension }) => ({ text, extension }));
    if (!(await failsWith(generated, others))) {
      counts.unstable++;
      return isNeverTheLoad(failure.kind) ? keepAsItIs(bed, generated, mode, failure, `same, by itself and beside the same ${others.length} programs`) : undefined;
    }
    counts.reductions++;
    const until = Date.now() > deadline ? 0 : Date.now() + settings.reduceSeconds * 1000;
    for (let size = Math.max(1, others.length >> 1); others.length && Date.now() < until; size = Math.max(1, size >> 1)) {
      let removed = false;
      for (let at = 0; at < others.length && Date.now() < until; ) {
        const fewer = [...others.slice(0, at), ...others.slice(at + size)];
        if (await failsWith(generated, fewer)) [others, removed] = [fewer, true];
        else at += size;
      }
      if (size === 1 && !removed) break;
    }
    const typed = generated.extension === "ts";
    const reduced = await reduce(generated.text, {
      parses: candidate => parses(candidate, typed),
      fails: async candidates => {
        const results: boolean[] = [];
        for (const text of candidates) results.push(await failsWith({ text, extension: generated.extension }, others));
        return results;
      },
      width: 1,
      seconds: Date.now() > deadline ? 0 : settings.reduceSeconds,
    });
    const small: Program = { text: reduced.text, extension: generated.extension };
    const group = `${failure.kind} only together`;
    const byShape = failure.kind === "different output" || failure.kind === "different exit code" || failure.kind === "hang" || failure.kind === "crash" || !failure.signature.includes(" ");
    const name = `${group} ${byShape ? Bun.hash.crc32(shape(small.text)).toString(16) : failure.signature}`.replace(/[^\w+&.-]+/g, "-").slice(0, 120);
    const target = join(out, "findings", name);
    if (existsSync(target)) return void counts.repeated++;
    perGroup.set(group, (perGroup.get(group) ?? readdirSync(join(out, "findings")).filter(each => each.startsWith(group.replace(/[^\w+&.-]+/g, "-"))).length) + 1);
    if (perGroup.get(group)! > 10) return void counts.repeated++;
    distinct.push(name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "commands.txt"), bed.store(target, [small, filler, ...others], mode.flags));
    writeFileSync(join(target, "original." + generated.extension), generated.text);
    const record = { kind: failure.kind, detail: failure.detail, guilty: ["only together"], bed: bed.name, mode: mode.name, flags: mode.flags, binary: bed.binary, source: generated.source, seed: generated.seed, notes: generated.notes, companions: others.length, found: new Date().toISOString() }; // prettier-ignore
    writeFileSync(join(target, "finding.json"), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(join(out, "findings.tsv"), [record.found, bed.name, mode.name, bed.binary, failure.kind, "only together", `${generated.source}:${generated.seed}`, name, failure.detail, `${others.length} companions`].join("\t") + "\n");
  }

  // What failed once and not at the next try: no smaller program can be looked for, so the program is stored whole, with what the next try gave.
  function keepAsItIs(bed: Bed, generated: Generated, mode: Mode, failure: Failure, nextTry: string, members: Generated[] = [], how = "not at the next try") {
    const name = `${failure.kind} ${how} ${Bun.hash.crc32(generated.text).toString(16)}`.replace(/[^\w+&.-]+/g, "-").slice(0, 120);
    const target = join(out, "findings", name);
    if (existsSync(target)) return void counts.repeated++;
    distinct.push(name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "original." + generated.extension), generated.text);
    if (members.length > 1 && bed.store) writeFileSync(join(target, "commands.txt"), bed.store(target, [generated, ...members.filter(each => each !== generated)], mode.flags));
    const record = { kind: failure.kind, detail: failure.detail, guilty: [how], nextTry, bed: bed.name, mode: mode.name, flags: mode.flags, binary: bed.binary, source: generated.source, seed: generated.seed, group: generated.group, notes: generated.notes, found: new Date().toISOString() }; // prettier-ignore
    writeFileSync(join(target, "finding.json"), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(join(out, "findings.tsv"), [record.found, bed.name, mode.name, bed.binary, failure.kind, how, `${generated.source}:${generated.seed}`, name, failure.detail, `the next try: ${nextTry}`].join("\t") + "\n");
  }

  async function keep(bed: Bed, folder: string, generated: Generated, mode: Mode, failure: Failure, members: Generated[]) {
    const together = members.length > 1;
    counts.findings++;
    const rule = knownAs(bed, mode.name, failure, generated.group);
    if (rule) return void (rule.count++, counts.known++);
    // The words of a crash or of a wrong line say little, so the group tells such findings apart. A message of the compiler says what is wrong by itself.
    const groupOf = (kind: string) => (generated.group && !["internal compiler error", "build crash", "build error", "build refused", "build hang"].includes(kind) ? `${generated.group} ` : "");
    // What runs out of its clock says no word, and many a death says only its signal, so all of them would count as one: they are told apart by source.
    const saysNothing = !failure.detail.includes(" ");
    const early = `${bed.name} ${groupOf(failure.kind)}${failure.kind} ${failure.detail.replace(/\d+/g, "N")}${saysNothing ? ` ${generated.source}` : ""}`;
    // The first that is set aside must not hide the rest of the run: of what is never meant, four are looked at until one is stored.
    const looks = seenEarly.get(early) ?? 0;
    if (looks >= (isNeverByDesign(failure.kind) ? 4 : 1)) return void counts.repeated++;
    seenEarly.set(early, looks + 1);
    const isStored = () => void seenEarly.set(early, Infinity);
    if (Date.now() > deadline && (Date.now() > lastCall || lateLooks++ >= confirmedBehindTheDeadline)) {
      counts.notConfirmed++;
      appendFileSync(join(out, "not-confirmed.tsv"), `${bed.binary}\t${generated.source}:${generated.seed}\t${described(bed, mode.name, failure, generated.group)}\t${mode.flags.join(" ")}\n`);
      if (isNeverTheLoad(failure.kind)) (keepAsItIs(bed, generated, mode, failure, "none: the run was over", members, "not tried again"), isStored());
      return;
    }

    // Once more, by itself: a program that fails one time in three, or only beside others, is kept apart.
    const again = await alone(bed, folder, generated, mode.flags);
    if (!sameFailure(failure, again.verdict)) {
      together ? counts.onlyTogether++ : counts.unstable++;
      appendFileSync(join(out, together ? "only-in-a-shared-build.tsv" : "unstable.tsv"), `${bed.binary}\t${generated.source}:${generated.seed}\t${described(bed, mode.name, failure, generated.group)}\t${mode.flags.join(" ")}\n`);
      if (together) return keepTogether(bed, folder, generated, members, mode, failure);
      if (isNeverTheLoad(failure.kind)) keepAsItIs(bed, generated, mode, failure, isFinding(again.verdict) ? `${again.verdict.kind}: ${again.verdict.detail}` : again.verdict.kind);
      return;
    }
    if ((await alone(bed, folder, generated, mode.flags)).plain.stdout !== again.plain.stdout) {
      counts.unstable++;
      return void appendFileSync(join(out, "unstable.tsv"), `${bed.binary}\t${generated.source}:${generated.seed}\tplain Bun prints something else each time: ${described(bed, mode.name, failure, generated.group)}\n`);
    }

    counts.reductions++;
    const typed = generated.extension === "ts";
    const stillFails = (judged: Judged) => sameFailure(failure, judged.verdict) && isFinding(judged.verdict) && !knownAs(bed, mode.name, judged.verdict, generated.group);
    // The case that fails by itself, if one does: one build for all of them.
    let whole = generated.text;
    if (generated.alone && generated.alone.length > 1 && Date.now() < deadline) {
      const failing = (await bed.judge(folder, generated.alone.map(text => ({ text, extension: generated.extension })), mode.flags)).findIndex(stillFails); // prettier-ignore
      if (failing >= 0 && stillFails(await alone(bed, folder, { text: generated.alone[failing], extension: generated.extension }, mode.flags))) whole = generated.alone[failing];
    }
    // Taking tokens out of a function whose text is printed changes what is printed, and every difference in the output counts as the same failure.
    const reprints = !typed && stillFails(await alone(bed, folder, { text: reprinted(generated.text), extension: generated.extension }, mode.flags));
    const printed = (text: string) => (reprints ? reprinted(text) : text);
    const reduceWith = (text: string, width: number, seconds: number) =>
      reduce(text, {
        parses: candidate => parses(candidate, typed),
        fails: async candidates => (await bed.judge(folder, candidates.map(text => ({ text: printed(text), extension: generated.extension })), mode.flags)).map(stillFails),
        width,
        seconds,
      });
    // Past the deadline the other workers wait for this one, so a finding is stored as it is.
    const isLate = () => Date.now() > deadline;
    const seconds = isLate() ? 0 : bed.batch === 1 ? settings.reduceSeconds / 3 : settings.reduceSeconds;
    let reduced = await reduceWith(whole, bed.batch === 1 ? 6 : bed.batch, seconds);
    let final = await alone(bed, folder, { text: printed(reduced.text), extension: generated.extension }, mode.flags);
    if (!stillFails(final)) {
      // What failed beside the other candidates does not fail by itself: again, one build per candidate.
      reduced = await reduceWith(whole, 1, seconds);
      final = await alone(bed, folder, { text: printed(reduced.text), extension: generated.extension }, mode.flags);
    }
    const small: Program = { text: printed(reduced.text), extension: generated.extension };
    const verdict = isFinding(final.verdict) ? final.verdict : failure;
    // What is left rests on something the bed does not have.
    if (!bed.allows(small.text)) return void counts.artifacts++;
    const cause = knownText("reduced", small.text) ?? known.find(entry => entry.where === "both" && entry.pattern.test(described(bed, mode.name, verdict, generated.group) + "\n" + small.text));
    if (cause && !(cause.where === "reduced" && isNeverByDesign(verdict.kind))) return void (cause.count++, counts.known++);
    const culprits = settings.attribute === false || isLate() ? [] : await guilty(bed, folder, small, mode, verdict);
    // Does the other bed see it too? What only the engine bed shows is often its stand-in library.
    const elsewhere: Record<string, string> = {};
    for (const { bed: other } of beds) {
      if (other === bed || !other.accepts(small)) continue;
      const there = (await alone(other, folder, small, other.modes(small).find(each => each.name === mode.name)?.flags ?? [])).verdict;
      elsewhere[other.name] = isFinding(there) ? `${there.kind}: ${there.detail}` : there.kind;
    }

    // A validating build checks at run time what the compiler took for proven. Where the default build is wrong and that one says nothing, a check is missing.
    const validating = mode.name === "default" ? bed.modes(small).find(each => each.name === "validate") : undefined;
    const validated = validating && !isLate() ? (await alone(bed, folder, small, validating.flags)).verdict : undefined;
    if (validated) elsewhere["validating build"] = !isFinding(validated) ? (validated.kind === "same" ? "right" : validated.why) : sameFailure(verdict, validated) ? "SILENT: it fails in the same way" : `${validated.kind}: ${validated.detail}`;

    const byShape = verdict.kind === "different output" || verdict.kind === "different exit code" || verdict.kind === "hang" || verdict.kind === "crash" || !verdict.signature.includes(" ");
    const group = `${groupOf(verdict.kind)}${verdict.kind} ${culprits.filter(name => name !== "flow-results").slice(0, 3).join("+") || (culprits.length ? "flow-results" : "no switch")}`;
    const name = `${group} ${byShape ? Bun.hash.crc32(shape(small.text)).toString(16) : verdict.signature}`.replace(/[^\w+&.-]+/g, "-").slice(0, 120);
    const target = join(out, "findings", name);
    isStored();
    if (existsSync(target)) return void counts.repeated++;
    // One cause shows in many shapes: after ten of a group the rest is only counted.
    perGroup.set(group, (perGroup.get(group) ?? readdirSync(join(out, "findings")).filter(each => each.startsWith(group.replace(/[^\w+&.-]+/g, "-"))).length) + 1);
    if (perGroup.get(group)! > 10) return void counts.repeated++;
    distinct.push(name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "reduced." + small.extension), small.text);
    writeFileSync(join(target, "original." + generated.extension), generated.text);
    writeFileSync(join(target, "plain.txt"), final.plain.stdout + (final.plain.exitCode ? `exit code ${final.plain.exitCode}\n${final.plain.stderr.slice(0, 2000)}` : ""));
    const run = final.compiled?.run;
    writeFileSync(join(target, "compiled.txt"), run ? run.stdout + (run.exitCode !== 0 ? `exit code ${run.exitCode} signal ${run.signal}\n${run.stderr.slice(0, 4000)}` : "") : (final.compiled?.build.stderr ?? "").slice(0, 8000) + (final.compiled?.build.stdout ?? "").slice(0, 2000));
    const record = { kind: verdict.kind, detail: verdict.detail, guilty: culprits, falseProof: culprits.includes("flow-results"), bed: bed.name, mode: mode.name, flags: mode.flags, binary: bed.binary, source: generated.source, seed: generated.seed, group: generated.group, notes: generated.notes, elsewhere, reduction: { tests: reduced.tests, builds: reduced.rounds }, found: new Date().toISOString() }; // prettier-ignore
    writeFileSync(join(target, "finding.json"), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(join(out, "findings.tsv"), [record.found, bed.name, mode.name, bed.binary, verdict.kind, culprits.join(","), `${generated.source}:${generated.seed}`, name, verdict.detail, Object.entries(elsewhere).map(([where, what]) => `${where === "validating build" ? "the" : "on the"} ${where}${where === "validating build" ? "" : " bed"}: ${what}`).join("; ")].join("\t") + "\n");
  }

  function next(bed: Bed): Generated | undefined {
    const seed = settings.firstSeed + sequence++;
    const source = wanted[new Random(seed).below(wanted.length)];
    try {
      const generated = sources[source](seed, bed);
      if (!generated) return void bump(counts.skipped, "no program");
      if (generated.standsAlone && !bed.buildsAlone) return void bump(counts.skipped, "needs a build to itself");
      const avoided = knownText("program", generated.text);
      if (avoided) return void (avoided.count++, bump(counts.skipped, "has a known bug in it"));
      return generated;
    } catch (error) {
      appendFileSync(join(out, "generator-errors.txt"), `${source}:${seed} ${error}\n`);
    }
  }

  async function round(bed: Bed, folder: string, size: number) {
    const drawn: Generated[] = [];
    for (let attempt = 0; drawn.length < size && attempt < size * 4 && !stopped(); attempt++) {
      const generated = next(bed);
      if (generated) drawn.push(generated);
    }
    // What TypeScript's own checker refuses does not count: it is a bug of the source.
    const forTypeScript = drawn.filter(generated => generated.isForTypeScript);
    if (forTypeScript.length && checker === "not asked") checker = typeChecker();
    if (forTypeScript.length && checker && checker !== "not asked") {
      checker(forTypeScript.map(generated => generated.text)).forEach((errors, index) => {
        if (!errors.length) return;
        const refused = forTypeScript[index];
        drawn.splice(drawn.indexOf(refused), 1);
        bump(counts.skipped, "refused by TypeScript");
        inGroup(refused, "refused by TypeScript");
        appendFileSync(join(out, "refused-by-typescript.tsv"), `${refused.source}:${refused.seed}\t${refused.group}\t${errors[0]}\n`);
      });
    }
    if (!drawn.length) return;
    for (const generated of drawn) (bump(counts.programs, `${bed.name} ${generated.source}`), inGroup(generated, "programs"));

    // The programs that mutants were made from go first, once each, in every mode: a mutant says nothing in a mode in which its base fails already.
    const inMode = (base: { name: string }, mode: Mode) => `${base.name} ${mode.name}`;
    const bases = [...new Map(drawn.flatMap(generated => (generated.base && !baseIsSame.has(inMode(generated.base, bed.modes(generated.base)[0])) ? [[generated.base.name, generated.base] as const] : []))).values()];
    const baseModes = new Map<string, { mode: Mode; members: typeof bases }>();
    for (const base of bases) for (const mode of bed.modes(base)) (baseModes.get(mode.name) ?? baseModes.set(mode.name, { mode, members: [] }).get(mode.name)!).members.push(base);
    for (const { mode, members } of baseModes.values()) {
      const judged = await bed.judge(folder, members, mode.flags);
      const whole: Generated[] = members.map(base => ({ ...base, source: "corpus", seed: 0, notes: base.name }));
      for (const [index, base] of members.entries()) {
        const { verdict } = judged[index];
        baseIsSame.set(inMode(base, mode), verdict.kind === "same");
        if (verdict.kind === "same") continue;
        if (mode.name === bed.modes(base)[0].name) rejected.add(base.name);
        appendFileSync(join(out, "corpus-failures.tsv"), `${bed.binary}\t${base.name}\t${mode.name}\t${verdict.kind}\t${isFinding(verdict) ? verdict.detail : verdict.kind === "skipped" ? verdict.why : ""}\n`);
        if (!isFinding(verdict) || knownAs(bed, mode.name, verdict)) continue;
        // The tests that run ../programs see a program that fails by itself with the default flags, on the text they run on. Here it may be another mode or a later text, so what is never meant is kept.
        if (members.length === 1 || (await alone(bed, folder, base, mode.flags)).verdict.kind !== "same") {
          if (isNeverByDesign(verdict.kind) && !settings.isCountOnly) await keep(bed, folder, whole[index], mode, verdict, [whole[index]]);
          continue;
        }
        counts.findings++;
        counts.onlyTogether++;
        appendFileSync(join(out, "only-in-a-shared-build.tsv"), `${bed.binary}\tcorpus:${base.name}\t${described(bed, mode.name, verdict)}\n`);
        await keepTogether(bed, folder, whole[index], whole, mode, verdict);
      }
    }
    const usable = drawn.filter(generated => !generated.base || baseIsSame.get(inMode(generated.base, bed.modes(generated.base)[0])));
    bump(counts.skipped, "base differs", drawn.length - usable.length);

    const modes = new Map<string, { mode: Mode; members: Generated[] }>();
    for (const generated of usable) {
      for (const mode of bed.modes(generated)) {
        if (generated.base && !baseIsSame.get(inMode(generated.base, mode))) bump(counts.skipped, `base differs in mode ${mode.name}`);
        else (modes.get(mode.name) ?? modes.set(mode.name, { mode, members: [] }).get(mode.name)!).members.push(generated);
      }
    }
    // A program that stops the compiler with the default flags stops it in the other modes too, and every such program in a shared build costs that build once more.
    const stopsTheBuild = new Set<Generated>();
    for (const { mode, members: all } of modes.values()) {
      const members = all.filter(generated => !stopsTheBuild.has(generated));
      if (members.length < all.length) bump(counts.skipped, `stops the build, not tried in mode ${mode.name}`, all.length - members.length);
      if (!members.length) continue;
      const look = async (generated: Generated, verdict: Verdict, inTheBuild: Generated[]) => {
        if (mode.name === bed.modes(generated)[0].name && ["internal compiler error", "build crash", "build hang", "build error", "build refused"].includes(verdict.kind)) stopsTheBuild.add(generated);
        if (verdict.kind === "skipped") bump(counts.skipped, verdict.why);
        else bump(counts.runs, `${bed.name} ${mode.name}`);
        inGroup(generated, `${mode.name} ${verdict.kind === "skipped" ? `skipped: ${verdict.why}` : verdict.kind}`);
        if (!isFinding(verdict)) return;
        appendFileSync(join(out, "failures.tsv"), `${bed.binary}\t${generated.source}:${generated.seed}\t${generated.group ?? ""}\t${mode.name}\t${verdict.kind}\t${verdict.detail}\t${inTheBuild.length} in the build\t${mode.flags.join(" ")}\n`);
        // Past the deadline too: a later run has other seeds and may never draw it again. There it is stored as it is, without a reduction, because the other workers wait.
        if (!settings.isCountOnly) await keep(bed, folder, generated, mode, verdict, inTheBuild);
      };
      // A program that is its own Worker, say, is the entry point of its build or it is another program.
      const units = [members.filter(generated => !generated.standsAlone), ...members.filter(generated => generated.standsAlone).map(generated => [generated])];
      for (const inTheBuild of units) {
        if (!inTheBuild.length) continue;
        if (Date.now() > lastCall) {
          bump(counts.skipped, `the run was over, not tried in mode ${mode.name}`, inTheBuild.length);
          continue;
        }
        const judged = await bed.judge(folder, inTheBuild, mode.flags);
        for (const [index, generated] of inTheBuild.entries()) await look(generated, judged[index].verdict, inTheBuild);
      }
    }
  }

  async function worker(bed: Bed, id: number) {
    const folder = join(work, `${bed.name}-${id}`);
    mkdirSync(folder, { recursive: true });
    const sizes = new Random(settings.firstSeed + id);
    while (!stopped()) {
      if (freeBytes(work) < settings.minFreeBytes || freeBytes(out) < settings.minFreeBytes) {
        writeStatus("paused: the disk is nearly full");
        await Bun.sleep(30_000);
        continue;
      }
      try {
        // A build of few programs proves more about each; a build of many gets through more.
        await round(bed, folder, Math.min(settings.batch ?? bed.batch, bed.batch === 1 ? 1 : sizes.pick([1, 8, bed.batch >> 1, bed.batch, bed.batch])));
      } catch (error) {
        appendFileSync(join(out, "driver-errors.txt"), `${new Date().toISOString()} ${error instanceof Error ? error.stack : error}\n`);
      }
      await Bun.sleep(0);
    }
  }

  const timer = setInterval(writeStatus, 20_000);
  writeStatus("starting");
  await Promise.all(beds.flatMap(({ bed, jobs }) => Array.from({ length: jobs }, (_, id) => worker(bed, id))));
  clearInterval(timer);
  writeStatus("ended");
  rmSync(work, { recursive: true, force: true });
  return { programs: total(), findings: counts.findings - counts.known, distinct, status: status("ended") };
}
