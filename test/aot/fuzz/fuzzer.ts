// The main loop: takes programs from the sources, has a runner judge them, and turns each failure into a stored
// finding: confirmed, reduced, attributed to a pass or a flow result, and deduplicated against the findings already
// stored.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { withoutInstallingPackages } from "../harness/without-installing-packages";
import {
  runtimeChecksVariable,
  verifierFlags,
  withoutVerifiersFlag,
  runEnvFlag,
  isFinding,
  isBuildFlag,
  sameFailure,
  withPrint,
  wholeText,
  writeProgram,
  type Runner,
  type Failure,
  type Judged,
  type Mode,
  type Program,
  type Verdict,
} from "./runners";
import { parses, reprinted } from "./mutate";
import { Random } from "./random";
import { reduce, reduceFiles, shape, type Reduction, type Whole } from "./reduce";
import {
  allSources,
  anotherCallSuffix,
  fourCallersSuffix,
  multiFileSuffix,
  neverTakenSuffix,
  ownCopiesSuffix,
  rewrittenSuffix,
  type Generated,
} from "./sources";
import { typeChecker, type Checker } from "./type-check";

export interface Settings {
  runners: { runner: Runner; jobs: number }[];
  out: string;
  work: string;
  programsRoot: string;
  seconds: number;
  /** Stop after this many programs, if set. */
  programs?: number;
  firstSeed: number;
  sources?: string[];
  /** Files of `<regex>\t<owner>\t<why>[\t<finding | reduced | both | program>]`: see accepted-differences.tsv. */
  known: string[];
  minFreeBytes: number;
  reduceSeconds: number;
  /**
   * Whether to search for the switches that make a finding go away, which takes a dozen builds or more. Default: yes.
   */
  attribute?: boolean;
  /** Maximum number of programs in one build. */
  batch?: number;
  /** Only list failures in failures.tsv and count them: nothing is confirmed, reduced or stored. */
  isCountOnly?: boolean;
  /** Also use the multi-file variant of each of `sources`, equally often, on runners that support it. */
  alsoMultiFile?: boolean;
  alsoRewritten?: boolean;
  alsoNeverTaken?: boolean;
  alsoAnotherCall?: boolean;
  alsoOwnCopies?: boolean;
  alsoFourCallers?: boolean;
  /** The clock that decides when the run is over. A test passes its own so that it never waits. */
  now?: () => number;
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
  /**
   * What the pattern is matched against: the description of the finding, the reduced program's text, both, or a
   * program's text before it runs.
   */
  where: string;
  count: number;
}

export async function fuzz(settings: Settings): Promise<Summary> {
  const { out, work, runners } = settings;
  const now = settings.now ?? Date.now;
  const started = now();
  const deadline = started + settings.seconds * 1000;
  // After the deadline every worker finishes its current batch, and failures there are still handled, because a later
  // run has other seeds. A shared build under a sanitizer takes minutes, so this work is bounded: a few failures are
  // confirmed, and after `lastCall` nothing is built again. Failures that load cannot cause are then stored unreduced;
  // the rest are only listed.
  const lastCall = deadline + Math.min(300, settings.seconds / 3) * 1000;
  const maxConfirmationsAfterDeadline = 4;
  let lateConfirmations = 0;
  for (const { runner } of runners) runner.lastCall = lastCall;
  mkdirSync(join(out, "findings"), { recursive: true });
  withoutInstallingPackages(work);

  const rejected = new Set<string>();
  const sources = await allSources(settings.programsRoot, rejected, true);
  const isVariant = (name: string) =>
    name.endsWith(multiFileSuffix) ||
    name.endsWith(rewrittenSuffix) ||
    name.endsWith(neverTakenSuffix) ||
    name.endsWith(anotherCallSuffix) ||
    name.endsWith(ownCopiesSuffix) ||
    name.endsWith(fourCallersSuffix);
  const wanted = (settings.sources ?? Object.keys(sources).filter(name => !isVariant(name))).filter(
    name => sources[name],
  );
  if (!wanted.length) throw new Error("no source of programs");
  const wantedWithVariants = wanted.flatMap(name =>
    isVariant(name)
      ? [name]
      : [
          name,
          ...(settings.alsoMultiFile ? [name + multiFileSuffix] : []),
          ...(settings.alsoRewritten ? [name + rewrittenSuffix] : []),
          ...(settings.alsoNeverTaken ? [name + neverTakenSuffix] : []),
          ...(settings.alsoAnotherCall ? [name + anotherCallSuffix] : []),
          ...(settings.alsoOwnCopies ? [name + ownCopiesSuffix] : []),
          ...(settings.alsoFourCallers ? [name + fourCallersSuffix] : []),
        ],
  );

  const known: Known[] = [];
  for (const file of settings.known) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const [pattern, owner, why, where = "finding"] = line.split("\t");
      if (line.startsWith("#") || why === undefined) continue;
      known.push({ pattern: new RegExp(pattern), owner, why, where, count: 0 });
    }
  }
  // Only the end of a long line is shown, prefixed with its offset. Accepted-difference patterns match "plain ..
  // compiled ..", so the prefix is removed.
  const described = (runner: Runner, mode: string, failure: Failure, group?: string) =>
    `${runner.name} ${mode} ${failure.kind} ${failure.detail.replace(/^at character \d+ of the line /, "")}${group ? ` | ${group}` : ""}`;
  const knownAs = (runner: Runner, mode: string, failure: Failure, group?: string) =>
    known.find(entry => entry.where === "finding" && entry.pattern.test(described(runner, mode, failure, group)));
  const knownText = (where: "reduced" | "program", text: string) =>
    known.find(entry => entry.where === where && entry.pattern.test(text));
  // A pattern that only looks at a program's text says where an executable may differ from plain Bun. It never excuses
  // a build timeout or a signal.
  const isAlwaysBug = (kind: string) =>
    ["build hang", "build crash", "internal compiler error", "crash", "hang"].includes(kind);
  // Load can make a slow run look like a hang. It cannot cause a signal or a compiler error message.
  const cannotBeCausedByLoad = (kind: string) => ["build crash", "internal compiler error", "crash"].includes(kind);

  const counts = {
    programs: {} as Record<string, number>,
    runs: {} as Record<string, number>,
    skipped: {} as Record<string, number>,
    findings: 0,
    known: 0,
    repeated: 0,
    unstable: 0,
    onlyTogether: 0,
    artifacts: 0,
    sameWithoutCompiler: 0,
    reductions: 0,
    notConfirmed: 0,
  };
  const distinct: string[] = [];
  /** Group, then "programs", "<mode> same" or "<mode> <kind of failure>". */
  const groups = new Map<string, Record<string, number>>();
  const inGroup = (generated: Generated, what: string) =>
    generated.group && bump(groups.get(generated.group) ?? groups.set(generated.group, {}).get(generated.group)!, what);
  let checker: Checker | undefined | "not asked" = "not asked";
  const bump = (table: Record<string, number>, key: string, by = 1) => (table[key] = (table[key] ?? 0) + by);
  const listed = (entries: Record<string, number>) => Object.entries(entries).sort().map(([key, count]) => `${key} ${count}`).join(", "); // prettier-ignore
  const total = () => Object.values(counts.programs).reduce((sum, count) => sum + count, 0);

  const status = (state: string) => {
    const hours = (now() - started) / 3_600_000;
    const rate = runners
      .map(
        ({ runner }) =>
          `${runner.name} ${Math.round(
            Object.entries(counts.programs)
              .filter(([key]) => key.startsWith(runner.name))
              .reduce((sum, [, count]) => sum + count, 0) / hours,
          )}/h`,
      )
      .join(", ");
    return (
      `${new Date().toISOString().slice(0, 19)}Z ${state} | binaries ${runners.map(({ runner }) => runner.binary).join(", ")} | seeds ${settings.firstSeed}.. | programs ${total()} (${listed(counts.programs)}) | rate ${rate} | compiled runs: ${listed(counts.runs)} | skipped: ${listed(counts.skipped)} | ` +
      `findings ${counts.findings}: known ${counts.known}, repeated ${counts.repeated}, unstable ${counts.unstable}, only in a shared build ${counts.onlyTogether}, of the runner ${counts.artifacts}, same without --aot ${counts.sameWithoutCompiler}, not confirmed ${counts.notConfirmed}, distinct in this run ${distinct.length}, distinct stored ${readdirSync(join(out, "findings")).length} | reductions ${counts.reductions}\n`
    );
  };
  const writeStatus = (state = "running") => {
    writeFileSync(join(out, "status.txt"), status(state));
    if (groups.size) writeFileSync(join(out, "groups.tsv"), [...groups].sort().map(([group, table]) => `${group}\t${listed(table)}\n`).join("")); // prettier-ignore
    writeFileSync(join(out, "known-counts.txt"), known.filter(entry => entry.count).map(entry => `${entry.count}\t${entry.owner}\t${entry.pattern.source}\t${entry.why}\n`).join("")); // prettier-ignore
  };

  const baseIsSame = new Map<string, boolean>();
  /** How many failures with this description were examined; unlimited once one of them is stored. */
  const seenEarly = new Map<string, number>();
  const perGroup = new Map<string, number>();
  let sequence = 0;

  const freeBytes = (path: string) => {
    const { bavail, bsize } = statfsSync(path);
    return Number(bavail) * Number(bsize);
  };
  const stopped = () =>
    now() > deadline ||
    existsSync(join(out, "STOP")) ||
    (settings.programs !== undefined && sequence >= settings.programs);

  const alone = async (runner: Runner, folder: string, program: Program, flags: string[]) =>
    (await runner.judge(folder, [program], flags))[0];
  const textsOf = ({ text, files }: Whole): Whole => ({ text, ...(files ? { files } : {}) });
  /**
   * A program's properties other than its text. They also apply to anything reduced from it, except entry points that
   * were removed.
   */
  const metadataOf = (
    { plainEnvironment, entryPoints, runsInOwnFolder, meant, unstablePlainOutput, mayBeRefused }: Program,
    { files }: Whole,
  ): Partial<Program> => ({
    ...(plainEnvironment && { plainEnvironment }),
    ...(unstablePlainOutput && { unstablePlainOutput }),
    ...(mayBeRefused && { mayBeRefused }),
    ...(entryPoints?.some(path => files?.[path] !== undefined) && {
      entryPoints: entryPoints.filter(path => files?.[path] !== undefined),
    }),
    ...(runsInOwnFolder && files && { runsInOwnFolder }),
    ...(meant && { meant }),
  });
  const bare = (program: Program): Program => ({
    ...textsOf(program),
    ...metadataOf(program, program),
    extension: program.extension,
  });

  // Files first, then lines.
  const cut = (
    program: Whole,
    extension: Program["extension"],
    { fails, width, seconds }: { fails(candidates: Whole[]): Promise<boolean[]>; width: number; seconds: number },
  ): Promise<Reduction & Whole> =>
    program.files
      ? reduceFiles(textsOf(program), {
          parses: (candidate, path = "main." + extension) =>
            !/\.[cm]?[jt]s$/.test(path) || parses(candidate, path.endsWith("ts")),
          fails,
          width,
          seconds,
          entry: "main." + extension,
        })
      : reduce(program.text, {
          parses: candidate => parses(candidate, extension === "ts"),
          fails: candidates => fails(candidates.map(text => ({ text }))),
          width,
          seconds,
        });

  // Finds the switches that make the failure go away. Where a build is cheap every switch is tried; otherwise one is
  // found by bisection. The search gets as long as a reduction: every attempt at a hang takes a run's whole time limit.
  async function guilty(
    runner: Runner,
    folder: string,
    program: Program,
    mode: Mode,
    failure: Failure,
  ): Promise<string[]> {
    // A different failure does not clear a switch: the build may reject the flags, or fail without the pass.
    const goesAway = async (flags: string[]) =>
      (await alone(runner, folder, program, [...mode.flags, ...flags])).verdict.kind === "same";
    const { flowResults, passes } = await runner.switches();
    const until = now() + settings.reduceSeconds * 1000;
    const found: string[] = [];
    // The compiler's verifiers are on in every mode. A build that they stop, and that ends without them, is one that no
    // user sees stop; what the executable then does is not asked: the program was reduced to whatever still stops the
    // build. They are meant to change no byte of an executable. Where a check at run time reports in the executable built
    // with them and not in the one built without, they did, and again it is no user's executable that is at fault.
    if (
      mode.flags.includes(verifierFlags) &&
      /^(internal compiler error|build |validation failure)/.test(failure.kind)
    ) {
      const flags = [...mode.flags.filter(flag => flag !== verifierFlags), withoutVerifiersFlag];
      const without = await alone(runner, folder, program, flags);
      if (failure.kind === "validation failure" ? without.verdict.kind === "same" : without.compiled?.run)
        found.push("the verifiers");
    }
    const withoutFlow = await goesAway(runner.withoutFlowResults);
    if (withoutFlow) found.push("flow-results");
    if (runner.batch === 1) {
      for (const name of withoutFlow ? [...flowResults, ...passes] : passes)
        if (now() < until && (await goesAway(runner.disabling([name])))) found.push(name);
      return found;
    }
    for (let names of withoutFlow ? [flowResults, passes] : [passes]) {
      if (now() > until || (names !== flowResults && !(await goesAway(runner.disabling(names))))) continue;
      while (names.length > 1 && now() < until) {
        const [first, second] = [names.slice(0, names.length >> 1), names.slice(names.length >> 1)];
        if (await goesAway(runner.disabling(first))) names = first;
        else if (await goesAway(runner.disabling(second))) names = second;
        else break;
      }
      found.push(
        names.length <= 4
          ? names.join("&")
          : `${names.length} of them${now() < until ? " together" : ", not narrowed"}`,
      );
    }
    return found;
  }

  // A failure that needs the other programs in its build, because the compiler analyzes all of them as one program.
  // Unneeded companions are removed first, then the program itself is reduced. Every attempt is a separate build.
  async function keepWithCompanions(
    runner: Runner,
    folder: string,
    generated: Generated,
    members: Generated[],
    mode: Mode,
    failure: Failure,
  ) {
    if (!runner.store) return;
    // An empty module keeps the build a shared one when no companion is left.
    const filler: Program = { text: "", extension: "js" };
    const failsWith = async (program: Program, others: Program[]) =>
      sameFailure(failure, (await runner.judge(folder, [program, filler, ...others], mode.flags))[0].verdict);
    let others: Program[] = members.filter(each => each !== generated).map(bare);
    if (!(await failsWith(generated, others))) {
      counts.unstable++;
      return cannotBeCausedByLoad(failure.kind)
        ? keepUnreduced(
            runner,
            generated,
            mode,
            failure,
            `same, by itself and beside the same ${others.length} programs`,
          )
        : undefined;
    }
    counts.reductions++;
    const until = now() > deadline ? 0 : now() + settings.reduceSeconds * 1000;
    for (let size = Math.max(1, others.length >> 1); others.length && now() < until; size = Math.max(1, size >> 1)) {
      let removed = false;
      for (let at = 0; at < others.length && now() < until;) {
        const fewer = [...others.slice(0, at), ...others.slice(at + size)];
        if (await failsWith(generated, fewer)) [others, removed] = [fewer, true];
        else at += size;
      }
      if (size === 1 && !removed) break;
    }
    const reduced = await cut(generated, generated.extension, {
      fails: async candidates => {
        const results: boolean[] = [];
        for (const candidate of candidates)
          results.push(
            await failsWith(
              { ...candidate, ...metadataOf(generated, candidate), extension: generated.extension },
              others,
            ),
          );
        return results;
      },
      width: 1,
      seconds: now() > deadline ? 0 : settings.reduceSeconds,
    });
    const small: Program = { ...textsOf(reduced), ...metadataOf(generated, reduced), extension: generated.extension };
    const group = `${failure.kind} only together`;
    const byShape =
      failure.kind === "different output" ||
      failure.kind === "different exit code" ||
      failure.kind === "hang" ||
      failure.kind === "crash" ||
      !failure.signature.includes(" ");
    const name = `${group} ${byShape ? Bun.hash.crc32(shape(wholeText(small))).toString(16) : failure.signature}`
      .replace(/[^\w+&.-]+/g, "-")
      .slice(0, 120);
    const target = join(out, "findings", name);
    if (existsSync(target)) return void counts.repeated++;
    perGroup.set(
      group,
      (perGroup.get(group) ??
        readdirSync(join(out, "findings")).filter(each => each.startsWith(group.replace(/[^\w+&.-]+/g, "-"))).length) +
        1,
    );
    if (perGroup.get(group)! > 10) return void counts.repeated++;
    distinct.push(name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "commands.txt"), runner.store(target, [small, filler, ...others], mode.flags));
    writeProgram(target, "original", generated);
    const record = { kind: failure.kind, detail: failure.detail, guilty: ["only together"], runner: runner.name, mode: mode.name, flags: mode.flags, binary: runner.binary, source: generated.source, seed: generated.seed, notes: generated.notes, companions: others.length, found: new Date().toISOString() }; // prettier-ignore
    writeFileSync(join(target, "finding.json"), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(
      join(out, "findings.tsv"),
      [
        record.found,
        runner.name,
        mode.name,
        runner.binary,
        failure.kind,
        "only together",
        `${generated.source}:${generated.seed}`,
        name,
        failure.detail,
        `${others.length} companions`,
      ].join("\t") + "\n",
    );
  }

  // It failed once and not on the next try, so it cannot be reduced: the whole program is stored, with the result of
  // the second try.
  function keepUnreduced(
    runner: Runner,
    generated: Generated,
    mode: Mode,
    failure: Failure,
    nextTry: string,
    members: Generated[] = [],
    how = "not at the next try",
  ) {
    const name = `${failure.kind} ${how} ${Bun.hash.crc32(wholeText(generated)).toString(16)}`
      .replace(/[^\w+&.-]+/g, "-")
      .slice(0, 120);
    const target = join(out, "findings", name);
    if (existsSync(target)) return void counts.repeated++;
    distinct.push(name);
    mkdirSync(target, { recursive: true });
    writeProgram(target, "original", generated);
    if (members.length > 1 && runner.store)
      writeFileSync(
        join(target, "commands.txt"),
        runner.store(target, [generated, ...members.filter(each => each !== generated)], mode.flags),
      );
    const record = { kind: failure.kind, detail: failure.detail, guilty: [how], nextTry, runner: runner.name, mode: mode.name, flags: mode.flags, binary: runner.binary, source: generated.source, seed: generated.seed, group: generated.group, notes: generated.notes, found: new Date().toISOString() }; // prettier-ignore
    writeFileSync(join(target, "finding.json"), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(
      join(out, "findings.tsv"),
      [
        record.found,
        runner.name,
        mode.name,
        runner.binary,
        failure.kind,
        how,
        `${generated.source}:${generated.seed}`,
        name,
        failure.detail,
        `the next try: ${nextTry}`,
      ].join("\t") + "\n",
    );
  }

  async function keep(
    runner: Runner,
    folder: string,
    generated: Generated,
    mode: Mode,
    failure: Failure,
    members: Generated[],
  ) {
    const together = members.length > 1;
    counts.findings++;
    const rule = knownAs(runner, mode.name, failure, generated.group);
    if (rule) return void (rule.count++, counts.known++);
    // The text of a crash or a wrong line says little, so the group separates such findings. A compiler error message
    // is specific enough by itself.
    const groupOf = (kind: string) =>
      generated.group &&
      !["internal compiler error", "build crash", "build error", "build refused", "build hang"].includes(kind)
        ? `${generated.group} `
        : "";
    // A timeout has no message and many crashes only name their signal, so they would all count as one finding: they
    // are separated by source.
    const hasNoMessage = !failure.detail.includes(" ");
    const early = `${runner.name} ${groupOf(failure.kind)}${failure.kind} ${failure.detail.replace(/\d+/g, "N")}${hasNoMessage ? ` ${generated.source}` : ""}`;
    // The first one that is set aside must not hide the others in this run: for failures that are always bugs, four are
    // examined until one is stored.
    const looks = seenEarly.get(early) ?? 0;
    if (looks >= (isAlwaysBug(failure.kind) ? 4 : 1)) return void counts.repeated++;
    seenEarly.set(early, looks + 1);
    const isStored = () => void seenEarly.set(early, Infinity);
    if (now() > deadline && (now() > lastCall || lateConfirmations++ >= maxConfirmationsAfterDeadline)) {
      counts.notConfirmed++;
      appendFileSync(
        join(out, "not-confirmed.tsv"),
        `${runner.binary}\t${generated.source}:${generated.seed}\t${described(runner, mode.name, failure, generated.group)}\t${mode.flags.join(" ")}\n`,
      );
      if (cannotBeCausedByLoad(failure.kind))
        (keepUnreduced(runner, generated, mode, failure, "none: the run was over", members, "not tried again"),
          isStored());
      return;
    }

    // Run it again alone: a program that fails one time in three, or only beside others, is kept separately.
    const again = await alone(runner, folder, generated, mode.flags);
    if (!sameFailure(failure, again.verdict)) {
      together ? counts.onlyTogether++ : counts.unstable++;
      appendFileSync(
        join(out, together ? "only-in-shared-build.tsv" : "unstable.tsv"),
        `${runner.binary}\t${generated.source}:${generated.seed}\t${described(runner, mode.name, failure, generated.group)}\t${mode.flags.join(" ")}\n`,
      );
      if (together) return keepWithCompanions(runner, folder, generated, members, mode, failure);
      if (cannotBeCausedByLoad(failure.kind))
        keepUnreduced(
          runner,
          generated,
          mode,
          failure,
          isFinding(again.verdict) ? `${again.verdict.kind}: ${again.verdict.detail}` : again.verdict.kind,
        );
      return;
    }
    if ((await alone(runner, folder, generated, mode.flags)).plain.stdout !== again.plain.stdout) {
      counts.unstable++;
      return void appendFileSync(
        join(out, "unstable.tsv"),
        `${runner.binary}\t${generated.source}:${generated.seed}\tplain Bun prints something else each time: ${described(runner, mode.name, failure, generated.group)}\n`,
      );
    }

    counts.reductions++;
    const typed = generated.extension === "ts";
    const stillFails = (judged: Judged) =>
      sameFailure(failure, judged.verdict) &&
      isFinding(judged.verdict) &&
      !knownAs(runner, mode.name, judged.verdict, generated.group);
    let start = textsOf(generated);
    // Does it need several files? If it also fails as a single file, reduce that.
    const failsAsSingleFile =
      generated.singleFileText === undefined
        ? undefined
        : stillFails(
            await alone(runner, folder, { text: generated.singleFileText, extension: generated.extension }, mode.flags),
          );
    if (failsAsSingleFile) start = { text: generated.singleFileText! };
    // The one case that fails alone, if there is one: one build tests all of them.
    if (generated.alone && generated.alone.length > 1 && now() < deadline) {
      const failing = (await runner.judge(folder, generated.alone.map(text => ({ text, extension: generated.extension })), mode.flags)).findIndex(stillFails); // prettier-ignore
      if (
        failing >= 0 &&
        stillFails(
          await alone(runner, folder, { text: generated.alone[failing], extension: generated.extension }, mode.flags),
        )
      )
        start = { text: generated.alone[failing] };
    }
    // Removing tokens from a function whose source text is printed changes the output, and any output difference counts
    // as the same failure.
    const reprints =
      !typed &&
      !start.files &&
      stillFails(
        await alone(
          runner,
          folder,
          { text: reprinted(generated.singleFileText ?? generated.text), extension: generated.extension },
          mode.flags,
        ),
      );
    const printed = (program: Whole): Program => ({
      ...textsOf(program),
      ...metadataOf(generated, program),
      ...(reprints ? { text: reprinted(program.text) } : {}),
      extension: generated.extension,
    });
    const reduceWith = (width: number, seconds: number) =>
      cut(start, generated.extension, {
        fails: async candidates => (await runner.judge(folder, candidates.map(printed), mode.flags)).map(stillFails),
        width,
        seconds,
      });
    // After the deadline the other workers wait for this one, so the finding is stored unreduced.
    const isLate = () => now() > deadline;
    const seconds = isLate() ? 0 : runner.batch === 1 ? settings.reduceSeconds / 3 : settings.reduceSeconds;
    let reduced = await reduceWith(runner.batch === 1 ? 6 : runner.batch, seconds);
    let final = await alone(runner, folder, printed(reduced), mode.flags);
    if (!stillFails(final)) {
      // It failed beside the other candidates but not alone: try again with one build per candidate.
      reduced = await reduceWith(1, seconds);
      final = await alone(runner, folder, printed(reduced), mode.flags);
    }
    const small = printed(reduced);
    const verdict = isFinding(final.verdict) ? final.verdict : failure;
    // What is left depends on something the runner does not have.
    if (!runner.allows(wholeText(small))) return void counts.artifacts++;
    const cause =
      knownText("reduced", wholeText(small)) ??
      known.find(
        entry =>
          entry.where === "both" &&
          entry.pattern.test(described(runner, mode.name, verdict, generated.group) + "\n" + wholeText(small)),
      );
    if (cause && !(cause.where === "reduced" && isAlwaysBug(verdict.kind))) return void (cause.count++, counts.known++);
    // An executable built without --aot differs from `bun <file>` in the same way, so the bundler or the standalone
    // runtime causes the difference, not the compiler.
    if (runner.withoutCompiler && isFinding(final.verdict) && verdict.kind.startsWith("different ")) {
      // The reducer can leave something that only a build without --aot rejects, such as an empty package.json. Then
      // the program it started from answers.
      for (const program of [small, printed(start)]) {
        const theirs = (await alone(runner, folder, program, [...mode.flags, ...runner.withoutCompiler])).compiled?.run;
        if (!theirs) continue;
        const ours = (program === small ? final : await alone(runner, folder, program, mode.flags)).compiled?.run;
        if (!ours || ours.stdout !== theirs.stdout || ours.exitCode !== theirs.exitCode) break;
        counts.sameWithoutCompiler++;
        return void appendFileSync(
          join(out, "same-without-aot.tsv"),
          `${runner.name}\t${mode.name}\t${verdict.kind}\t${generated.source}:${generated.seed}\t${verdict.detail}\n`,
        );
      }
    }
    const culprits = settings.attribute === false || isLate() ? [] : await guilty(runner, folder, small, mode, verdict);
    // Does the other runner see it too? What only the engine runner shows is often caused by its stand-in library.
    const elsewhere: Record<string, string> = {};
    for (const { runner: other } of runners) {
      if (other === runner || !other.accepts(small)) continue;
      const there = (
        await alone(other, folder, small, other.modes(small).find(each => each.name === mode.name)?.flags ?? [])
      ).verdict;
      elsewhere[other.name] = isFinding(there) ? `${there.kind}: ${there.detail}` : there.kind;
    }

    // A validating build checks at run time what the compiler proved. If the default build is wrong and the validating
    // build reports nothing, a check is missing.
    const validating = mode.name === "default" ? runner.modes(small).find(each => each.name === "validate") : undefined;
    const validated =
      validating && !isLate() ? (await alone(runner, folder, small, validating.flags)).verdict : undefined;
    if (validated)
      elsewhere["validating build"] = !isFinding(validated)
        ? validated.kind === "same"
          ? "right"
          : validated.why
        : sameFailure(verdict, validated)
          ? "SILENT: it fails in the same way"
          : `${validated.kind}: ${validated.detail}`;

    const byShape =
      verdict.kind === "different output" ||
      verdict.kind === "different exit code" ||
      verdict.kind === "hang" ||
      verdict.kind === "crash" ||
      !verdict.signature.includes(" ");
    const group = `${groupOf(verdict.kind)}${verdict.kind} ${
      culprits
        .filter(name => name !== "flow-results")
        .slice(0, 3)
        .join("+") || (culprits.length ? "flow-results" : "no switch")
    }`;
    const name = `${group} ${byShape ? Bun.hash.crc32(shape(wholeText(small))).toString(16) : verdict.signature}`
      .replace(/[^\w+&.-]+/g, "-")
      .slice(0, 120);
    const target = join(out, "findings", name);
    isStored();
    if (existsSync(target)) return void counts.repeated++;
    // One cause shows up in many shapes: after ten findings in a group the rest are only counted.
    perGroup.set(
      group,
      (perGroup.get(group) ??
        readdirSync(join(out, "findings")).filter(each => each.startsWith(group.replace(/[^\w+&.-]+/g, "-"))).length) +
        1,
    );
    if (perGroup.get(group)! > 10) return void counts.repeated++;
    distinct.push(name);
    mkdirSync(target, { recursive: true });
    // As the runner ran them, so that each shows the failure outside the fuzzer too.
    writeProgram(target, "reduced", withPrint(small));
    writeProgram(target, "original", withPrint(generated));
    // The same program in the format of ../parallel, ready to land with its fix: its first lines hold what the build
    // and the runs need.
    const flags = mode.flags.filter(flag => isBuildFlag(flag) && (flag !== verifierFlags || !final.compiled?.run));
    const head = [
      flags.length ? `// Flags: ${flags.join(" ")}` : "",
      small.entryPoints?.length
        ? `// Entry points: ${small.entryPoints.map(path => `./${path.replace(/^\.\//, "")}`).join(" ")}`
        : "",
      ...mode.flags
        .filter(flag => flag.startsWith(runEnvFlag))
        .map(flag => `// Env of the executable: ${flag.slice(runEnvFlag.length)}`),
      verdict.detail.includes(runtimeChecksVariable) ? `// Env of the executable: ${runtimeChecksVariable}` : "",
      final.plain.exitCode ? `// Exit code: ${final.plain.exitCode}` : "",
    ];
    const whole = withPrint(small);
    writeProgram(join(out, "as-tests"), name, {
      ...whole,
      text:
        head
          .filter(Boolean)
          .map(line => line + "\n")
          .join("") + whole.text,
    });
    writeFileSync(
      join(target, "plain.txt"),
      final.plain.stdout +
        (final.plain.exitCode ? `exit code ${final.plain.exitCode}\n${final.plain.stderr.slice(0, 2000)}` : ""),
    );
    const run = final.compiled?.run;
    writeFileSync(
      join(target, "compiled.txt"),
      run
        ? run.stdout +
            (run.exitCode !== 0 ? `exit code ${run.exitCode} signal ${run.signal}\n${run.stderr.slice(0, 4000)}` : "")
        : (final.compiled?.build.stderr ?? "").slice(0, 8000) + (final.compiled?.build.stdout ?? "").slice(0, 2000),
    );
    const record = { kind: verdict.kind, detail: verdict.detail, guilty: culprits, falseProof: culprits.includes("flow-results"), runner: runner.name, mode: mode.name, flags: mode.flags, binary: runner.binary, source: generated.source, seed: generated.seed, group: generated.group, notes: generated.notes, ...(failsAsSingleFile === undefined ? {} : { failsAsSingleFile }), elsewhere, reduction: { tests: reduced.tests, builds: reduced.rounds }, found: new Date().toISOString() }; // prettier-ignore
    writeFileSync(join(target, "finding.json"), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(
      join(out, "findings.tsv"),
      [
        record.found,
        runner.name,
        mode.name,
        runner.binary,
        verdict.kind,
        culprits.join(","),
        `${generated.source}:${generated.seed}`,
        name,
        verdict.detail,
        Object.entries(elsewhere)
          .map(
            ([where, what]) =>
              `${where === "validating build" ? "the" : "on the"} ${where}${where === "validating build" ? "" : " runner"}: ${what}`,
          )
          .join("; "),
      ].join("\t") + "\n",
    );
  }

  function next(runner: Runner): Generated | undefined {
    const seed = settings.firstSeed + sequence++;
    const from = runner.supportsMultiFile ? wantedWithVariants : wanted;
    const source = from[new Random(seed).below(from.length)];
    try {
      const generated = sources[source](seed, runner);
      if (!generated) return void bump(counts.skipped, "no program");
      // In `bun <file>`, whether an unhandled rejection is reported before or after the immediates depends on whether
      // the file is the entry point. In an executable, with or without --aot, it does not.
      if (/\bunhandledRejection\b/.test(generated.text)) generated.needsOwnBuild = true;
      if (generated.needsOwnBuild && !runner.supportsOwnBuild)
        return void bump(counts.skipped, "needs a build to itself");
      const avoided = knownText("program", wholeText(generated));
      if (avoided) return void (avoided.count++, bump(counts.skipped, "has a known bug in it"));
      return generated;
    } catch (error) {
      bump(counts.skipped, "the source threw");
      appendFileSync(join(out, "generator-errors.txt"), `${source}:${seed} ${error}\n`);
    }
  }

  async function round(runner: Runner, folder: string, size: number) {
    const drawn: Generated[] = [];
    for (let attempt = 0; drawn.length < size && attempt < size * 4 && !stopped(); attempt++) {
      const generated = next(runner);
      if (generated) drawn.push(generated);
    }
    // A program that TypeScript's own checker rejects does not count: that is a bug in the source.
    const forTypeScript = drawn.filter(generated => generated.isForTypeScript);
    if (forTypeScript.length && checker === "not asked") checker = typeChecker();
    if (forTypeScript.length && checker && checker !== "not asked") {
      checker(forTypeScript).forEach((errors, index) => {
        if (!errors.length) return;
        const refused = forTypeScript[index];
        drawn.splice(drawn.indexOf(refused), 1);
        bump(counts.skipped, "refused by TypeScript");
        inGroup(refused, "refused by TypeScript");
        appendFileSync(
          join(out, "refused-by-typescript.tsv"),
          `${refused.source}:${refused.seed}\t${refused.group}\t${errors[0]}\n`,
        );
      });
    }
    if (!drawn.length) return;
    for (const generated of drawn)
      (bump(counts.programs, `${runner.name} ${generated.source}`), inGroup(generated, "programs"));

    // The base programs of the mutants run first, once each, in every mode: a mutant means nothing in a mode where its
    // base already fails.
    const inMode = (base: { name: string }, mode: Mode) => `${base.name} ${mode.name}`;
    const bases = [
      ...new Map(
        drawn.flatMap(generated =>
          generated.base && !baseIsSame.has(inMode(generated.base, runner.modes(generated.base)[0]))
            ? [[generated.base.name, generated.base] as const]
            : [],
        ),
      ).values(),
    ];
    const baseModes = new Map<string, { mode: Mode; members: typeof bases }>();
    for (const base of bases)
      for (const mode of runner.modes(base))
        (baseModes.get(mode.name) ?? baseModes.set(mode.name, { mode, members: [] }).get(mode.name)!).members.push(
          base,
        );
    for (const { mode, members } of baseModes.values()) {
      const judged = await runner.judge(folder, members, mode.flags);
      const whole: Generated[] = members.map(base => ({ ...base, source: "corpus", seed: 0, notes: base.name }));
      for (const [index, base] of members.entries()) {
        const { verdict } = judged[index];
        baseIsSame.set(inMode(base, mode), verdict.kind === "same");
        if (verdict.kind === "same") continue;
        if (mode.name === runner.modes(base)[0].name) rejected.add(base.name);
        appendFileSync(
          join(out, "corpus-failures.tsv"),
          `${runner.binary}\t${base.name}\t${mode.name}\t${verdict.kind}\t${isFinding(verdict) ? verdict.detail : verdict.kind === "skipped" ? verdict.why : ""}\n`,
        );
        if (!isFinding(verdict) || knownAs(runner, mode.name, verdict)) continue;
        // The tests over ../programs catch a program that fails alone with the default flags on their version of it.
        // Here the mode or the text may differ, so failures that are always bugs are kept.
        if (members.length === 1 || (await alone(runner, folder, base, mode.flags)).verdict.kind !== "same") {
          if (isAlwaysBug(verdict.kind) && !settings.isCountOnly)
            await keep(runner, folder, whole[index], mode, verdict, [whole[index]]);
          continue;
        }
        counts.findings++;
        counts.onlyTogether++;
        appendFileSync(
          join(out, "only-in-shared-build.tsv"),
          `${runner.binary}\tcorpus:${base.name}\t${described(runner, mode.name, verdict)}\n`,
        );
        await keepWithCompanions(runner, folder, whole[index], whole, mode, verdict);
      }
    }
    const usable = drawn.filter(
      generated => !generated.base || baseIsSame.get(inMode(generated.base, runner.modes(generated.base)[0])),
    );
    bump(counts.skipped, "base differs", drawn.length - usable.length);

    const modes = new Map<string, { mode: Mode; members: Generated[] }>();
    for (const generated of usable) {
      for (const mode of runner.modes(generated)) {
        if (mode.isForSharedBuilds && (usable.length === 1 || generated.needsOwnBuild)) continue;
        if (generated.base && !baseIsSame.get(inMode(generated.base, mode)))
          bump(counts.skipped, `base differs in mode ${mode.name}`);
        else
          (modes.get(mode.name) ?? modes.set(mode.name, { mode, members: [] }).get(mode.name)!).members.push(generated);
      }
    }
    // A program that stops the compiler with the default flags also stops it in the other modes, and every such program
    // in a shared build costs one more build.
    const stopsBuild = new Set<Generated>();
    // If plain Bun fails on a program once, it is not run again for the other modes.
    const plainRunFailed = new Set<Generated>();
    for (const { mode, members: all } of modes.values()) {
      const built = all.filter(generated => !stopsBuild.has(generated));
      if (built.length < all.length)
        bump(counts.skipped, `stops the build, not tried in mode ${mode.name}`, all.length - built.length);
      const members = built.filter(generated => !plainRunFailed.has(generated));
      if (members.length < built.length)
        bump(counts.skipped, `plain run failed, not tried in mode ${mode.name}`, built.length - members.length);
      if (!members.length) continue;
      const look = async (generated: Generated, verdict: Verdict, inTheBuild: Generated[]) => {
        if (
          mode.name === runner.modes(generated)[0].name &&
          ["internal compiler error", "build crash", "build hang", "build error", "build refused"].includes(
            verdict.kind,
          )
        )
          stopsBuild.add(generated);
        if (verdict.kind === "skipped" && verdict.why.startsWith("plain run ")) plainRunFailed.add(generated);
        if (verdict.kind === "skipped") bump(counts.skipped, verdict.why);
        else bump(counts.runs, `${runner.name} ${mode.name}`);
        inGroup(generated, `${mode.name} ${verdict.kind === "skipped" ? `skipped: ${verdict.why}` : verdict.kind}`);
        if (!isFinding(verdict)) return;
        appendFileSync(
          join(out, "failures.tsv"),
          `${runner.binary}\t${generated.source}:${generated.seed}\t${generated.group ?? ""}\t${mode.name}\t${verdict.kind}\t${verdict.detail}\t${inTheBuild.length} in the build\t${mode.flags.join(" ")}\n`,
        );
        // Also after the deadline: a later run has other seeds and may never generate it again. It is stored unreduced,
        // because the other workers are waiting.
        if (!settings.isCountOnly) await keep(runner, folder, generated, mode, verdict, inTheBuild);
      };
      // Some programs must be the entry point of their build, for example a program that starts itself as a Worker.
      const units = [
        members.filter(generated => !generated.needsOwnBuild),
        ...members.filter(generated => generated.needsOwnBuild).map(generated => [generated]),
      ];
      for (const inTheBuild of units) {
        if (!inTheBuild.length) continue;
        if (now() > lastCall) {
          bump(counts.skipped, `the run was over, not tried in mode ${mode.name}`, inTheBuild.length);
          continue;
        }
        const judged = await runner.judge(folder, inTheBuild, mode.flags);
        for (const [index, generated] of inTheBuild.entries()) await look(generated, judged[index].verdict, inTheBuild);
      }
    }
  }

  async function worker(runner: Runner, id: number) {
    const folder = join(work, `${runner.name}-${id}`);
    mkdirSync(folder, { recursive: true });
    const sizes = new Random(settings.firstSeed + id);
    while (!stopped()) {
      if (freeBytes(work) < settings.minFreeBytes || freeBytes(out) < settings.minFreeBytes) {
        writeStatus("paused: the disk is nearly full");
        await Bun.sleep(30_000);
        continue;
      }
      try {
        // A build with few programs proves more about each; a build with many has more throughput.
        await round(
          runner,
          folder,
          Math.min(
            settings.batch ?? runner.batch,
            runner.batch === 1 ? 1 : sizes.pick([1, 8, runner.batch >> 1, runner.batch, runner.batch]),
          ),
        );
      } catch (error) {
        appendFileSync(
          join(out, "driver-errors.txt"),
          `${new Date().toISOString()} ${error instanceof Error ? error.stack : error}\n`,
        );
      }
      await Bun.sleep(0);
    }
  }

  const timer = setInterval(writeStatus, 20_000);
  writeStatus("starting");
  await Promise.all(runners.flatMap(({ runner, jobs }) => Array.from({ length: jobs }, (_, id) => worker(runner, id))));
  clearInterval(timer);
  writeStatus("ended");
  rmSync(work, { recursive: true, force: true });
  return { programs: total(), findings: counts.findings - counts.known, distinct, status: status("ended") };
}
