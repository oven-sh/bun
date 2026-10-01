// usage: bun crashes-md.ts <directory observed/> <raw.jsonl> <class-c-causes.tsv> <out CRASHES.md> [--leak <raw-leak.jsonl>] [--say "<line>"]...
// Writes the text of CRASHES.md from the table of the sweep (observed/instances.tsv), the raw runs of raw.ts and the
// causes that were written by hand for the class C differences. Every --say line goes into the head of the file.
// It starts no process.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const positional: string[] = [];
const say: string[] = [];
let leakPath: string | undefined;
for (let k = 0; k < argv.length; k++) {
  if (argv[k] === "--leak") leakPath = argv[++k];
  else if (argv[k] === "--say") say.push(argv[++k]);
  else positional.push(argv[k]);
}
const [observedArg, rawPath, causesPath, outPath] = positional;
if (outPath === undefined) {
  console.error("usage: bun crashes-md.ts <directory observed/> <raw.jsonl> <class-c-causes.tsv> <out CRASHES.md> [--leak <raw-leak.jsonl>] [--say <line>]...");
  process.exit(2);
}
const observed = resolve(observedArg);

interface Instance {
  name: string;
  kind: string;
  casePath: string;
  outcome: string;
  class: string;
  code: string;
  reason: string;
}
const instances: Instance[] = readFileSync(join(observed, "instances.tsv"), "utf8")
  .split("\n")
  .filter(line => line !== "")
  .map(line => {
    const [name, kind, casePath, outcome, cls, code, reason] = line.split("\t");
    return { name, kind, casePath, outcome, class: cls, code, reason: reason ?? "" };
  });

interface Alone {
  file: string;
  died: string;
  exitCode: number | null;
  signal: string | number | null;
  ms: number;
  stdout?: string;
  stderr: string;
}
interface Raw {
  name: string;
  kind: string;
  casePath: string;
  roots?: string[];
  currentDirectory?: string;
  ms?: number;
  exitCode?: number | null;
  signal?: string | number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  died?: string;
  alone?: Alone[];
  notLaid?: string;
  threw?: string;
}
const read = (path: string): Raw[] =>
  readFileSync(resolve(path), "utf8")
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line) as Raw)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const raws = read(rawPath);
const leaks = leakPath === undefined ? undefined : read(leakPath);

const causes = new Map<string, { owner: string; cause: string }>();
for (const line of readFileSync(resolve(causesPath), "utf8").split("\n")) {
  if (line === "") continue;
  const [casePath, owner, cause] = line.split("\t");
  causes.set(casePath, { owner, cause });
}

const fence = "```";
const count = (n: number) => n.toLocaleString("en-US");
const run = instances.length;
const notLaid = instances.filter(i => i.class === "not-laid-out").length;
const diedInSweep = instances.filter(i => !["silent", "diagnostic", "not-laid-out", "timeout"].includes(i.class));
const hungInSweep = instances.filter(i => i.class === "timeout");

// The owner that the first frames name, for a reader who starts from this file.
function ownerOf(text: string): string {
  const at = (needle: string) => {
    const index = text.indexOf(needle);
    return index < 0 ? Infinity : index;
  };
  const candidates: [string, number][] = [
    ["a rule (src/lint/rules)", at("bun_lint::rules::")],
    ["the linter (src/lint)", at("bun_lint::")],
    ["the parser (src/js_parser)", at("bun_js_parser::")],
    ["the command (src/runtime/cli/lint_command.rs)", at("lint_command")],
    ["the tree (src/ast)", at("bun_ast::")],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][1] === Infinity ? "not named by the frames" : candidates[0][0];
}

function entriesOf(list: Raw[], title: string): string[] {
  const out: string[] = [];
  const dead = list.filter(raw => (raw.died ?? "") !== "" && raw.timedOut !== true);
  const hung = list.filter(raw => raw.timedOut === true);
  const lost = list.filter(raw => raw.threw !== undefined || raw.notLaid !== undefined);
  // One entry for the runs of one case that died the same way.
  const groups = new Map<string, Raw[]>();
  for (const raw of [...dead, ...hung]) {
    const first = (raw.stderr ?? "").split("\n").find(line => /panic|ERROR|error:|Sanitizer|assert/i.test(line)) ?? "";
    const key = `${raw.casePath}\n${raw.died}\n${first}`;
    let group = groups.get(key);
    if (group === undefined) groups.set(key, (group = []));
    group.push(raw);
  }
  out.push(`${title}: ${dead.length} runs died and ${hung.length} did not end within the limit, of ${list.length} runs; ${groups.size} entries.`);
  if (lost.length > 0) out.push(`${lost.length} of the runs could not be made again: ${lost.map(raw => `${raw.name} (${raw.threw ?? raw.notLaid})`).join("; ")}.`);
  out.push("");
  for (const group of groups.values()) {
    const raw = group[0];
    const reproducing = (raw.alone ?? []).filter(alone => alone.died !== "");
    const unit = reproducing.length > 0 ? reproducing[0] : undefined;
    const text = `${raw.stderr ?? ""}\n${raw.stdout ?? ""}`;
    out.push(`### ${raw.casePath}${unit === undefined ? "" : `, unit ${unit.file}`}`);
    out.push("");
    out.push(`- Instances (${group.length}): ${group.map(r => `\`${r.name}\` (class ${r.kind})`).join(", ")}`);
    out.push(`- Root files of the instance: ${(raw.roots ?? []).map(r => `\`${r}\``).join(" ")}, current directory \`${raw.currentDirectory}\``);
    out.push(`- Ended: ${raw.died}; exit code ${raw.exitCode}, signal ${raw.signal}, after ${raw.ms} ms`);
    if (unit !== undefined) {
      out.push(`- One file alone reproduces it: \`${unit.file}\` (${unit.died}; exit code ${unit.exitCode}, signal ${unit.signal})${reproducing.length > 1 ? `; so do ${reproducing.slice(1).map(a => `\`${a.file}\``).join(", ")}` : ""}`);
      out.push(`- Command, in the directory of the laid out instance: \`BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1 BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 <binary> --lint ${unit.file.replace(/^\//, "")}\``);
    } else {
      out.push(`- No root file alone reproduces it: the command needs ${(raw.roots ?? []).length} files, in the order above.`);
    }
    out.push(`- Likely owner: ${ownerOf(text)}`);
    out.push("- stderr, first lines:");
    out.push("");
    out.push(fence);
    out.push(...(unit?.stderr ?? raw.stderr ?? "").split("\n").slice(0, 25));
    out.push(fence);
    const frames = (unit?.stdout ?? raw.stdout ?? "").split("\n").filter(line => line !== "").slice(0, 24);
    if (frames.length > 0) {
      out.push("");
      out.push("- stdout, first lines (a debug build prints the frames of a panic there):");
      out.push("");
      out.push(fence);
      out.push(...frames);
      out.push(fence);
    }
    out.push("");
  }
  return out;
}

const md: string[] = [];
md.push("# Crashes and hangs of `bun --lint` on the conformance corpus");
md.push("");
for (const line of say) md.push(line);
if (say.length > 0) md.push("");
md.push(`Instances that the reference runs: ${count(run)}. Not laid out on this disk (no process started): ${count(notLaid)}. Processes of \`<binary> --lint <root files>\` in the sweep: ${count(run - notLaid)}.`);
md.push(`The sweep reports as died: ${diedInSweep.length}; as not ended within 120 s: ${hungInSweep.length}.`);
for (const i of [...diedInSweep, ...hungInSweep]) md.push(`- \`${i.name}\` (${i.casePath}): ${i.outcome}: ${i.reason}`);
md.push("");
md.push("What counts as a crash: the command ended by a signal, with an exit code that is not 0 or 2, wrote to stdout, or wrote a line to stderr that is no diagnostic (a panic, a report of a sanitizer). What counts as a hang: no end within 120 s. A diagnostic of Bun's parser or of a rule is neither: the default check of today calls such a run `crash` as well, with the reason `stderr line n has the code <name>, which is no code of TypeScript`, and those are counted in the survey table of LOG.md, not here.");
md.push("");
md.push("## Crashes and hangs");
md.push("");
md.push(...entriesOf(raws, "Every instance whose outcome in the sweep was crash or timeout, run again with stdout and stderr kept"));
if (leaks !== undefined) {
  md.push("## The same instances with the leak check of CI");
  md.push("");
  md.push("`BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=<tree>/test/leaksan.supp`: a report of LeakSanitizer ends the command with SIGABRT. Only the instances above were run this way, not the ones that stay silent.");
  md.push("");
  md.push(...entriesOf(leaks, "With the leak check"));
}

// The class C differences, for the parser unit.
const groups = new Map<string, { casePath: string; names: string[]; roots: string[]; stderr: string }>();
for (const raw of raws) {
  if (raw.kind !== "C" || (raw.stderr ?? "") === "" || (raw.died ?? "") !== "") continue;
  const key = `${raw.casePath}\n${raw.stderr}`;
  let group = groups.get(key);
  if (group === undefined) groups.set(key, (group = { casePath: raw.casePath, names: [], roots: raw.roots ?? [], stderr: raw.stderr! }));
  group.names.push(raw.name);
}
const differing = [...groups.values()].sort((a, b) => (a.casePath < b.casePath ? -1 : 1));
md.push("## For the parser unit: class C instances where Bun reports what TypeScript does not");
md.push("");
md.push(`These are differences, not crashes. The reference (typescript-go at the pinned commit) reports nothing for these ${differing.reduce((n, g) => n + g.names.length, 0)} instances of ${differing.length} cases, and neither project has an error baseline of their names; \`bun --lint\` prints a diagnostic and ends with 2. A line is as the command printed it: the path is relative to the current directory of the instance, the line and the column are those of the unit (the case file has its directive lines above). The owner and the cause are a reading of the case and of the source, not the result of a fix.`);
md.push("");
const without: string[] = [];
for (const group of differing) {
  const cause = causes.get(group.casePath);
  if (cause === undefined) without.push(group.casePath);
  md.push(`### ${group.casePath}`);
  md.push("");
  md.push(`- Instances: ${group.names.map(name => `\`${name}\``).join(", ")}; root files ${group.roots.map(r => `\`${r}\``).join(" ")}`);
  md.push(`- Owner: ${cause?.owner ?? "not looked at"}`);
  md.push(`- Cause: ${cause?.cause ?? "not looked at"}`);
  md.push("");
  md.push(fence);
  md.push(...group.stderr.trimEnd().split("\n"));
  md.push(fence);
  md.push("");
}
const unused = [...causes.keys()].filter(casePath => !differing.some(group => group.casePath === casePath));
writeFileSync(resolve(outPath), md.join("\n"));
console.log(`${outPath}: ${md.length} lines; class C differences ${differing.length} cases; without a cause: ${without.join(", ") || "none"}; causes of cases that are not in the run: ${unused.join(", ") || "none"}`);
