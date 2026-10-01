#!/usr/bin/env python3
# usage: mk.py <tree> [--glue]
# Lays the prototype of the sweep tool (--each, --shard, --resume, the tables of outcomes) over sweep.ts and
# runner/expectations.ts of a tree. With --glue the tree has the binding of round2/corpus-glue/bottom-up laid over it.
import re
import sys

tree = sys.argv[1]
glue = "--glue" in sys.argv[2:]
home = f"{tree}/test/cli/lint/conformance"


def edit(path, pairs):
    with open(path, encoding="utf8") as f:
        text = f.read()
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"{path}: {n} matches of: {old[:90]!r}")
        text = text.replace(old, new)
    with open(path, "w", encoding="utf8") as f:
        f.write(text)


instance_of = "fact.instance" if glue else "fact.run!"
oracle_of = "corpus.oracle(fact.instance)" if glue else "readOracle(fact.run!.oracle)"
input_of = "corpus.input(instance, root)" if glue else "inputOf(paths, instance as RunInstance, root)"
oracle_option = (
    "oracle: instance => corpus.oracle(instance),"
    if glue
    else "oracle: instance => readOracle((instance as RunInstance).oracle),"
)

helpers = r'''type Outcome = RunResult["outcome"];

// How many instances had each outcome, of those whose oracle has errors and of those whose oracle has none.
type OutcomeCounts = Record<Kind, Partial<Record<Outcome, number>>>;

// The instances that ran by a key of theirs: the outcomes of each class, in the order of the keys.
function outcomesBy(
  ran: readonly Fact[],
  outcomeOf: (fact: Fact) => Outcome,
  key: (fact: Fact) => string,
): Map<string, OutcomeCounts> {
  const out = new Map<string, OutcomeCounts>();
  for (const fact of ran) {
    let counts = out.get(key(fact));
    if (counts === undefined) out.set(key(fact), (counts = { E: {}, C: {} }));
    const ofKind = counts[fact.kind!];
    const outcome = outcomeOf(fact);
    ofKind[outcome] = (ofKind[outcome] ?? 0) + 1;
  }
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

function sumOf(rows: Iterable<OutcomeCounts>): OutcomeCounts {
  const total: OutcomeCounts = { E: {}, C: {} };
  for (const row of rows) {
    for (const kind of ["E", "C"] as const) {
      for (const outcome of outcomes) {
        const n = row[kind][outcome];
        if (n !== undefined) total[kind][outcome] = (total[kind][outcome] ?? 0) + n;
      }
    }
  }
  return total;
}

// Counts by outcome in the order of the list outcomes, whichever instance came first: a report of the same outcomes has the same text.
function ordered(counts: Partial<Record<Outcome, number>>): Partial<Record<Outcome, number>> {
  return Object.fromEntries(outcomes.filter(outcome => counts[outcome] !== undefined).map(o => [o, counts[o]]));
}

// The lines of a table of outcomes: below the names of the columns a row for each key, and for each class the instances that ran and those of each outcome that an instance of a row had.
function outcomeTable(rows: readonly (readonly [string, OutcomeCounts])[], kinds: readonly Kind[]): string[] {
  const all = sumOf(rows.map(([, counts]) => counts));
  const columns = kinds.flatMap(kind => {
    const had = outcomes.filter(outcome => all[kind][outcome] !== undefined);
    const ran = (counts: OutcomeCounts) => had.reduce((sum, outcome) => sum + (counts[kind][outcome] ?? 0), 0);
    const one = (outcome: Outcome) => (counts: OutcomeCounts) => counts[kind][outcome] ?? 0;
    return [{ head: `${kind} run`, cell: ran }, ...had.map(outcome => ({ head: `${kind} ${outcome}`, cell: one(outcome) }))];
  });
  const width = Math.max(...rows.map(([key]) => key.length));
  const widths = columns.map(c => Math.max(c.head.length, ...rows.map(([, counts]) => String(c.cell(counts)).length)));
  const line = (key: string, cells: readonly string[]) =>
    `  ${key.padEnd(width)}  ${cells.map((cell, k) => cell.padStart(widths[k])).join("  ")}`;
  const heads = columns.map(c => c.head);
  return [line("", heads), ...rows.map(([key, counts]) => line(key, columns.map(c => String(c.cell(counts)))))];
}

// A character that would break a line of output or hide in it, as an escape.
function escaped(c: string): string {
  return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
}

// The most that a line of output shows of a line of a baseline: display of run.ts cuts the lines of a diff there.
const shownLength = 500;

// A line of a baseline as display of run.ts shows a line of a diff: an escape and a line break as text, and the start of a long line.
function displayed(line: string): string {
  const text = line.replaceAll("\x1b", "\\x1b").replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  return text.length > shownLength ? text.slice(0, shownLength) + "..." : text;
}

// A displayed line as a JSON string: every space of it shows, and it ends where the string ends. "..." follows the string of a line that was cut.
function quoted(line: string): string {
  const cut = line.length > shownLength;
  const text = JSON.stringify(cut ? line.slice(0, shownLength) : line).replace(/[\x7f-\x9f\u2028\u2029]/g, escaped);
  return cut ? `${text}...` : text;
}

// The reason of run.ts for an instance with errors whose check reported nothing: line 1 of the oracle is what differs first.
const nothingReported = "no diagnostic where the oracle has a baseline";

// "line 3: - <line of the oracle> + <line of the check>" from the diff of a result: the first line of each side. Undefined: the diff is in no form that this reads.
function firstDifference(diff: string): string | undefined {
  const [head, ...lines] = diff.split("\n");
  const at = /^@@ line ([0-9]+) @@$/.exec(head);
  const side = (mark: string) => {
    const line = lines.find(l => l.startsWith(`${mark} `));
    return line === undefined ? "" : ` ${mark} ${quoted(line.slice(2))}`;
  };
  const sides = side("-") + side("+");
  return at === null || sides === "" ? undefined : `line ${at[1]}:${sides}`;
}

// The one line of --each for an instance: its outcome, its name, and for what is no pass the first line that differs or the reason. An instance that the reference does not run has no result: it is a skip with the reason.
function lineOf(fact: Fact, result: RunResult | undefined, firstOfOracle: () => string | undefined): string {
  let detail: string | undefined;
  if (result === undefined) {
    detail = fact.status === "invalid" ? `the reference fails the instance: ${fact.reason}` : fact.reason;
  } else if (result.outcome !== "pass") {
    if (result.diff !== undefined) detail = firstDifference(result.diff);
    if (detail === undefined && result.reason === nothingReported) {
      const first = firstOfOracle();
      if (first !== undefined) detail = `line 1: - ${quoted(displayed(first))}`;
    }
    detail ??= result.reason;
  }
  const skip: Outcome = "skip";
  const head = `${result?.outcome ?? skip} ${fact.name}`;
  const line = detail === undefined || detail === "" ? head : `${head} ${detail}`;
  return line.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, escaped);
}

// What a file of --resume holds of a result: every field but the instance and the bytes of the baseline.
type Kept = Omit<RunResult, "instance" | "actual"> & { name: string };

// The first line of a file of --resume: the outcomes below it are of this check and this corpus.
interface ResumeHead {
  check: string;
  // The size and the time of the last change of what the check runs: the binary under test, or the module of the check and the binary that runs it.
  stamp: string;
  corpus: string;
}

// The size and the time of the last change of each file: outcomes of a file that was written again are not those of the one before.
function stampOf(files: readonly string[]): string {
  return files
    .map(file => {
      const { size, mtimeMs } = statSync(file);
      return `${file}: ${size} bytes, changed ${new Date(mtimeMs).toISOString()}`;
    })
    .join("; ");
}

// The outcomes that a file of --resume holds, by the name of their instance; the file is made with its first line where it is not there. Every outcome is a line that ends in a line feed: what follows the last one is of a run that was ended, and is cut off.
function openResume(path: string, head: ResumeHead): Map<string, Kept> {
  const kept = new Map<string, Kept>();
  let lines: string[];
  try {
    lines = (existsSync(path) ? readFileSync(path, "utf8") : "").split("\n");
    const cut = lines.pop() !== "";
    if (lines.length === 0) writeFileSync(path, JSON.stringify(head) + "\n");
    else if (cut) writeFileSync(path, lines.join("\n") + "\n");
  } catch (error) {
    throw new FileError(`--resume ${path}: ${messageOf(error)}`);
  }
  for (const [k, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new FileError(`--resume ${path}: line ${k + 1} is no JSON`);
    }
    if (k === 0) {
      const was = value as Partial<ResumeHead> | null;
      for (const key of ["check", "stamp", "corpus"] as const) {
        if (was?.[key] === head[key]) continue;
        const other = `its ${key} is ${JSON.stringify(was?.[key])} and that of this run is ${JSON.stringify(head[key])}`;
        throw new FileError(`--resume ${path}: the outcomes are of another sweep: ${other}`);
      }
      continue;
    }
    const { name, outcome, reason } = (value ?? {}) as Partial<Kept>;
    if (typeof name !== "string" || typeof reason !== "string" || !outcomes.includes(outcome as Outcome)) {
      throw new FileError(`--resume ${path}: line ${k + 1} is no outcome of an instance`);
    }
    kept.set(name, value as Kept);
  }
  return kept;
}

'''

sweep = [
    (
        "// The sweep: the instances of the corpus through a check, the pass counts by directory and by diagnostic code, the lists of expectations.json and a report file.\n",
        "// The sweep: the instances of the corpus through a check, their outcomes by directory and by diagnostic code, the lists of expectations.json and a report file; or one line for each instance.\n",
    ),
    (
        'import { availableParallelism, tmpdir } from "node:os";\n',
        'import { appendFileSync, statSync, writeSync } from "node:fs";\nimport { availableParallelism, tmpdir } from "node:os";\n',
    ),
    (
        '  compiler/   conformance/types/tuple/    a directory of the cases with everything below it; it ends in "/"\n',
        '  compiler   conformance/types/tuple/     a directory of the cases with everything below it; "/" at its end or not\n',
    ),
    (
        "  --bin <path>           binary under test of the default check, which runs it with --lint and the files of an\n",
        """  --each                 print on stdout one line for each instance of the selection and nothing else, in the
                         order of the names; the check, the counts and the place of a report go to stderr:
                           pass <name>
                           fail <name> line <n>: - <line of the oracle> + <line of the check>
                           <outcome> <name> <reason>
                         The second form is the first line at which the baseline of the check parts from the oracle,
                         each side as a JSON string; a side that has no such line is left out. The third form is
                         every other outcome, and "skip" with the reason for an instance that the reference does not
                         run. No instance is held against a list, and a report is written only where --report names
                         it. When the reader of stdout goes away, no further instance is run
  --bin <path>           binary under test of the default check, which runs it with --lint and the files of an
""",
    ),
    (
        "  --jobs <n>             instances in flight (default: the number of processors)\n  --timeout <ms>         limit of one instance (default: 60000)\n",
        """  --jobs <n>             instances in flight (default: 4, or the number of processors where that is less)
  --timeout <ms>         limit of one instance (default: 60000)
  --shard <k>/<n>        only every n-th instance of the selection in the order of the names, from the k-th on: the
                         n shards of a selection hold each of its instances once
  --resume <file>        keep the outcomes that the file holds and run only the other instances; every outcome of
                         this run is added to the file as it is known, and the file is made where it is not there.
                         The file is of one check and one corpus: with the shards of a sweep it makes one sweep of
                         several runs, and a run without --shard after them prints the counts of all of them
""",
    ),
    (
        """Exit code 0: every listed instance of the selection passes and no name left a list that may hold it; with --round-trip,
every error baseline is written back with its bytes. 1: not so. 2: the command line is wrong, or the corpus, the lists,
the module of the check or the file of the report cannot be used.`;""",
        """Exit code 0: every listed instance of the selection passes and no name left a list that may hold it; with --each,
every instance of the selection that the reference runs passes; with --round-trip, every error baseline is written
back with its bytes. 1: not so. 2: the command line is wrong, or the corpus, the lists, the module of the check, the
file of --resume or the file of the report cannot be used.`;""",
    ),
    (
        "interface Options {\n  selectors: string[];\n  bin: string | undefined;\n",
        "interface Options {\n  selectors: string[];\n  each: boolean;\n  bin: string | undefined;\n",
    ),
    (
        "  timeoutMs: number;\n  listed: boolean;\n  kind: Kind | undefined;\n",
        "  timeoutMs: number;\n  shard: { part: number; of: number } | undefined;\n  resume: string | undefined;\n  listed: boolean;\n  kind: Kind | undefined;\n",
    ),
    (
        '  "--jobs",\n  "--timeout",\n  "--kind",\n  "--tag",\n  "--report",\n  "--since",\n  "--expectations",\n  "--corpus",\n]);\n// The options that say how instances are run',
        '  "--jobs",\n  "--timeout",\n  "--shard",\n  "--resume",\n  "--kind",\n  "--tag",\n  "--report",\n  "--since",\n  "--expectations",\n  "--corpus",\n]);\n// The options that say how instances are run',
    ),
    (
        'const ofARun = ["--bin", "--check", "--no-files", "--jobs", "--timeout", "--update", "--report"];\n',
        """const ofARun = [
  "--each",
  "--bin",
  "--check",
  "--no-files",
  "--jobs",
  "--timeout",
  "--shard",
  "--resume",
  "--update",
  "--report",
];
// The instances in flight where --jobs names no number: a check that starts a command keeps no more of them alive.
const defaultJobs = 4;
""",
    ),
    (
        "    selectors: [],\n    bin: undefined,\n",
        "    selectors: [],\n    each: false,\n    bin: undefined,\n",
    ),
    (
        "    timeoutMs: 60_000,\n    listed: false,\n",
        "    timeoutMs: 60_000,\n    shard: undefined,\n    resume: undefined,\n    listed: false,\n",
    ),
    (
        '    switch (name) {\n      case "--bin":\n',
        '    switch (name) {\n      case "--each":\n        o.each = true;\n        break;\n      case "--bin":\n',
    ),
    (
        '      case "--listed":\n        o.listed = true;\n        break;\n',
        """      case "--shard": {
        const m = /^([0-9]+)\\/([0-9]+)$/.exec(value!);
        const [part, of] = m === null ? [0, 0] : [Number(m[1]), Number(m[2])];
        if (part < 1 || part > of || !Number.isSafeInteger(of)) {
          throw new UsageError(`--shard ${value}: <k>/<n> with k from 1 to n`);
        }
        o.shard = { part, of };
        break;
      }
      case "--resume":
        o.resume = value;
        break;
      case "--listed":
        o.listed = true;
        break;
""",
    ),
    (
        "  if (useless.length > 0) throw new UsageError(`--no-run runs no instance: ${useless.join(\", \")} cannot go with it`);\n  return o;\n",
        """  if (useless.length > 0) throw new UsageError(`--no-run runs no instance: ${useless.join(", ")} cannot go with it`);
  const ofTheLists = o.each ? ["--update", "--since"].filter(name => seen.has(name)) : [];
  if (ofTheLists.length > 0) {
    throw new UsageError(`--each holds no instance against a list: ${ofTheLists.join(", ")} cannot go with it`);
  }
  return o;
""",
    ),
    (
        "interface CodeCount {\n  // Instances whose oracle has the code, and those of them that pass.\n  instances: number;\n  pass: number;\n  // Diagnostics with the code in the oracles of those instances.\n  diagnostics: number;\n}\n",
        "interface CodeCount {\n  // Instances whose oracle has the code, and those of them that pass.\n  instances: number;\n  pass: number;\n  // Diagnostics with the code in the oracles of those instances.\n  diagnostics: number;\n  // How many of those instances had each outcome.\n  outcomes: Partial<Record<Outcome, number>>;\n}\n",
    ),
    (
        "// Every error baseline of the corpus read and written again from what was read: the whole of what the test file samples.\n",
        helpers
        + "// Every error baseline of the corpus read and written again from what was read: the whole of what the test file samples.\n",
    ),
    (
        """  let checked: NamedCheck | undefined;
  if (o.run) {
    checked = await checkOf(o);
    try {
      mkdirSync(dirname(reportPath), { recursive: true });
    } catch (error) {
      throw new FileError(`--report ${reportPath}: ${messageOf(error)}`);
    }
  }
""",
        """  // With --each a report is written only where --report names it.
  const reports = !o.each || o.report !== undefined;
  let checked: NamedCheck | undefined;
  const resumePath = o.resume === undefined ? undefined : resolve(o.resume);
  let kept = new Map<string, Kept>();
  if (o.run) {
    checked = await checkOf(o);
    try {
      if (reports) mkdirSync(dirname(reportPath), { recursive: true });
    } catch (error) {
      throw new FileError(`--report ${reportPath}: ${messageOf(error)}`);
    }
    if (resumePath !== undefined) {
      // A check of a module runs in the binary that runs this script.
      const files = checked.binary === undefined ? [checked.name, process.execPath] : [checked.binary];
      let stamp: string;
      try {
        stamp = stampOf(files);
      } catch (error) {
        throw new FileError(`--resume: ${messageOf(error)}`);
      }
      kept = openResume(resumePath, { check: checked.name, stamp, corpus: corpusRoot });
    }
  }
""",
    ),
    (
        "  const caseOf = (name: string) => byBaseName.get(name) ?? byBaseName.get(caseBaseName(name));\n",
        """  const caseOf = (name: string) => byBaseName.get(name) ?? byBaseName.get(caseBaseName(name));
  // A selector that is a directory of the cases takes everything below it, with or without "/" at its end.
  const directoriesOfCases = new Set<string>();
  for (const path of cases) {
    let at = path.lastIndexOf("/");
    while (at > 0 && !directoriesOfCases.has(path.slice(0, at))) {
      directoriesOfCases.add(path.slice(0, at));
      at = path.lastIndexOf("/", at - 1);
    }
  }
  o.selectors = o.selectors.map(selector => (directoriesOfCases.has(selector) ? `${selector}/` : selector));
""",
    ),
    (
        """  if (selection.empty.length > 0) {
    const isDirectory = (selector: string) => cases.some(path => path.startsWith(`${selector}/`));
    const said = selection.empty.map(s => (isDirectory(s) ? `${s} (a directory ends in "/")` : s));
    throw new UsageError(`no instance for ${said.join(", ")}`);
  }
  const selected = selection.taken;
""",
        """  if (selection.empty.length > 0) throw new UsageError(`no instance for ${selection.empty.join(", ")}`);
  // The order of the names, which is that of the lists, whatever the order of the selectors: a shard is every n-th instance of it.
  const inOrder = selection.taken.sort((a, b) => (a.name < b.name ? -1 : 1));
  const shard = o.shard;
  const selected = shard === undefined ? inOrder : inOrder.filter((_, k) => k % shard.of === shard.part - 1);
""",
    ),
    (
        "  const say = (line = \"\") => {\n    text.push(line);\n    console.log(line);\n  };\n",
        "  const say = (line = \"\") => {\n    text.push(line);\n    if (!o.each) console.log(line);\n  };\n",
    ),
    (
        f"""  say(`check ${{checked.name}}`);
  const directory = o.files && ran.length > 0 ? makeTemporaryDirectory("bun-lint-sweep-") : undefined;
  let results: RunResult[];
  try {{
    let done = 0;
    results = await runInstances(
      ran.map(fact => {instance_of}),
      checked.check,
      {{
        input: (instance, root) => {input_of},
        {oracle_option}
        directory,
        concurrency: o.jobs ?? availableParallelism(),
        timeoutMs: o.timeoutMs,
        onResult() {{
          done++;
          if (!process.stderr.isTTY) {{
            if (done % 2000 === 0) console.error(`${{done}} of ${{ran.length}}`);
          }} else if (done % 50 === 0 || done === ran.length) {{
            process.stderr.write(`\\r${{done}} of ${{ran.length}}${{done === ran.length ? "\\n" : ""}}`);
          }}
        }},
      }},
    );
  }} finally {{
    if (directory !== undefined) rmSync(directory, {{ recursive: true, force: true }});
  }}

  const resultOf = new Map(results.map(r => [r.instance.name, r]));
""",
        f"""  say(`check ${{checked.name}}`);
  if (o.each) console.error(`check ${{checked.name}}`);
  const resultOf = new Map<string, RunResult>();
  for (const fact of ran) {{
    const was = kept.get(fact.name);
    if (was === undefined) continue;
    const {{ name: _name, ...rest }} = was;
    resultOf.set(fact.name, {{ instance: {instance_of}, ...rest }});
  }}
  const toRun = ran.filter(fact => !resultOf.has(fact.name));
  if (resumePath !== undefined) {{
    const resumed = `resume ${{resumePath}}: ${{resultOf.size}} outcomes kept, ${{toRun.length}} instances to run`;
    say(resumed);
    if (o.each) console.error(resumed);
  }}
  const directory = o.files && toRun.length > 0 ? makeTemporaryDirectory("bun-lint-sweep-") : undefined;
  // A reason may name a file below the directory of an instance, which is another in every run: what is left is the name that the instance has for the file.
  const written =
    directory === undefined
      ? undefined
      : new RegExp(`${{directory.replace(/[.*+?^${{}}()|[\\]\\\\]/g, "\\\\$&")}}[\\\\\\\\/][0-9a-z]+`, "g");
  // --each: the line of an instance is printed when the lines of all the instances before it are.
  const place = new Map(selected.map((fact, k) => [fact.name, k]));
  const lines = new Array<string | undefined>(o.each ? selected.length : 0);
  let printed = 0;
  // The reader of the lines went away, or the file of --resume takes no outcome: no instance after that is laid out or checked.
  let gone = false;
  let lost: FileError | undefined;
  const decoder = new TextDecoder();
  const settle = (fact: Fact) => {{
    if (!o.each) return;
    lines[place.get(fact.name)!] = lineOf(fact, resultOf.get(fact.name), () => {{
      try {{
        return decoder.decode({oracle_of}).split("\\r\\n", 1)[0];
      }} catch {{
        return undefined;
      }}
    }});
    while (!gone && printed < lines.length && lines[printed] !== undefined) {{
      try {{
        // A write to a pipe that nobody reads fails here, where console.log says nothing.
        writeSync(1, lines[printed++] + "\\n");
      }} catch (error) {{
        if ((error as {{ code?: unknown }}).code !== "EPIPE") throw error;
        gone = true;
      }}
    }}
  }};
  for (const fact of selected) if (fact.status !== "run" || resultOf.has(fact.name)) settle(fact);
  try {{
    let done = 0;
    // The lines of --each on a terminal are the progress.
    const progress = !o.each || !process.stdout.isTTY;
    await runInstances(
      toRun.map(fact => {instance_of}),
      checked.check,
      {{
        input: (instance, root) =>
          gone ? {{ ok: false, reason: "the reader of the lines went away" }} : {input_of},
        {oracle_option}
        directory,
        concurrency: o.jobs ?? Math.min(defaultJobs, availableParallelism()),
        timeoutMs: o.timeoutMs,
        onResult(result) {{
          if (gone) return;
          if (written !== undefined) result.reason = result.reason.replace(written, "");
          const {{ instance, actual: _actual, ...rest }} = result;
          resultOf.set(instance.name, result);
          try {{
            if (resumePath !== undefined) appendFileSync(resumePath, JSON.stringify({{ name: instance.name, ...rest }}) + "\\n");
          }} catch (error) {{
            lost = new FileError(`--resume ${{resumePath}}: ${{messageOf(error)}}`);
            gone = true;
            return;
          }}
          settle(facts.get(instance.name)!);
          done++;
          if (!process.stderr.isTTY) {{
            if (done % 2000 === 0) console.error(`${{done}} of ${{toRun.length}}`);
          }} else if (progress && (done % 50 === 0 || done === toRun.length)) {{
            process.stderr.write(`\\r${{done}} of ${{toRun.length}}${{done === toRun.length ? "\\n" : ""}}`);
          }}
        }},
      }},
    );
  }} finally {{
    if (directory !== undefined) rmSync(directory, {{ recursive: true, force: true }});
  }}
  if (lost !== undefined) throw lost;
  if (gone) return 1;
  const results = ran.map(fact => resultOf.get(fact.name)!);
  if (o.each) {{
    const words = countBy(lines, line => line!.slice(0, line!.indexOf(" ")));
    const counted = outcomes.filter(word => words.has(word)).map(word => `${{word}} ${{words.get(word)}}`);
    console.error(`instances ${{lines.length}}${{counted.length === 0 ? "" : `: ${{counted.join(", ")}}`}}`);
  }}

""",
    ),
    (
        """  const directories = rowsBy(ran, passes, fact => fact.directory);
  if (directories.size > 0) {
    const cut = cutOf([...directories.keys()]);
    const groups = rowsBy(ran, passes, fact => cut(fact.directory));
    const width = Math.max(...[...groups.keys()].map(group => group.length));
    const padded = ([pass, all]: Cell) => `${String(pass).padStart(5)} of ${String(all).padEnd(5)}`;
    say();
    say(
      "by directory: instances that pass, of those whose oracle has errors (E) and of those whose oracle has none (C)",
    );
    for (const [group, row] of groups) {
      say(`  ${group.padEnd(width)}  E ${padded(row.E)}  C ${padded(row.C)}`.trimEnd());
    }
  }
""",
        """  const outcomeOf = (fact: Fact) => resultOf.get(fact.name)!.outcome;
  const directories = rowsBy(ran, passes, fact => fact.directory);
  const directoryOutcomes = outcomesBy(ran, outcomeOf, fact => fact.directory);
  // A class without an instance is no part of a table.
  const kinds = (["E", "C"] as const).filter(kind => (kind === "E" ? ranE : ranC).length > 0);
  if (directories.size > 0) {
    const cut = cutOf([...directories.keys()]);
    const groups = [...outcomesBy(ran, outcomeOf, fact => cut(fact.directory))];
    const total = ["total", sumOf(groups.map(([, counts]) => counts))] as const;
    say();
    say(
      "by directory: of the instances whose oracle has errors (E) and of those whose oracle has none (C), those that ran and those of each outcome",
    );
    for (const line of outcomeTable([...groups, total], kinds)) say(line);
  }
""",
    ),
    (
        "      if (count === undefined) codes.set(code, (count = { instances: 0, pass: 0, diagnostics: 0 }));\n      count.instances++;\n      if (passes(fact)) count.pass++;\n      count.diagnostics += all.filter(other => other === code).length;\n",
        "      if (count === undefined) codes.set(code, (count = { instances: 0, pass: 0, diagnostics: 0, outcomes: {} }));\n      count.instances++;\n      if (passes(fact)) count.pass++;\n      count.diagnostics += all.filter(other => other === code).length;\n      count.outcomes[outcomeOf(fact)] = (count.outcomes[outcomeOf(fact)] ?? 0) + 1;\n",
    ),
    (
        """    say(`by diagnostic code: ${byCode.length} codes; instances that pass, of those whose oracle has the code`);
    for (const [code, count] of byCode.slice(0, 25)) {
      say(`  ${`TS${code}`.padEnd(8)} ${String(count.pass).padStart(5)} of ${count.instances}`);
    }
""",
        """    say(`by diagnostic code: ${byCode.length} codes; the instances whose oracle has the code and those of each outcome`);
    const most = byCode.slice(0, 25).map(([code, count]) => [`TS${code}`, { E: count.outcomes, C: {} }] as const);
    for (const line of outcomeTable(most, ["E"])) say(line);
""",
    ),
    (
        "    codes: Object.fromEntries(byCode.map(([code, count]) => [`TS${code}`, count])),\n",
        "    codes: Object.fromEntries(\n      byCode.map(([code, count]) => [`TS${code}`, { ...count, outcomes: ordered(count.outcomes) }]),\n    ),\n",
    ),
    (
        "    only: { listed: o.listed, kind: o.kind, tag: o.tag },\n",
        "    only: { listed: o.listed, kind: o.kind, tag: o.tag, shard: o.shard },\n    resumed: resumePath === undefined ? undefined : { file: resumePath, kept: ran.length - toRun.length },\n",
    ),
    (
        "    directories: Object.fromEntries(directories),\n",
        "    directories: Object.fromEntries(directories),\n    directoryOutcomes: Object.fromEntries(\n      [...directoryOutcomes].map(([directory, counts]) => [directory, { E: ordered(counts.E), C: ordered(counts.C) }]),\n    ),\n",
    ),
    (
        """  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\\n");
  } catch (error) {
    throw new FileError(`--report ${reportPath}: ${messageOf(error)}`);
  }
  console.log(`report ${reportPath}`);
""",
        """  try {
    if (reports) writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\\n");
  } catch (error) {
    throw new FileError(`--report ${reportPath}: ${messageOf(error)}`);
  }
  if (o.each) {
    if (reports) console.error(`report ${reportPath}`);
    // An instance that the reference does not run has no outcome to hold against an oracle: it is a line and no failure.
    return ran.every(passes) ? 0 : 1;
  }
  console.log(`report ${reportPath}`);
""",
    ),
]

sweep += [
    (
        """function matcher(selector: string): (fact: Fact) => boolean {
  if (selector.includes("*")) {
    const parts = selector.split("*").map(part => part.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"));
    const pattern = new RegExp(`^${parts.join(".*")}$`, "s");
    return fact => pattern.test(fact.name);
  }
  if (selector.endsWith("/")) return fact => `${fact.directory}/`.startsWith(selector);
  if (selector.includes("/")) return fact => fact.casePath === selector;
  return fact => fact.name === selector || fact.casePath.endsWith(`/${selector}`);
}
""",
        """// A selector that is tried on every instance: a pattern of names, or a directory of cases.
function matcher(selector: string): (fact: Fact) => boolean {
  if (!selector.includes("*")) return fact => `${fact.directory}/`.startsWith(selector);
  const parts = selector.split("*").map(part => part.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"));
  const pattern = new RegExp(`^${parts.join(".*")}$`, "s");
  return fact => pattern.test(fact.name);
}
""",
    ),
    (
        """  const matchers = o.selectors.map(selector => ({ selector, matches: matcher(selector), taken: 0 }));
  const taken: Fact[] = [];
  for (const fact of all) {
    let selected = matchers.length === 0;
    for (const m of matchers) {
      if (!m.matches(fact)) continue;
      m.taken++;
      selected = true;
    }
""",
        """  // Each selector once, with the number of instances that it took.
  const hits = new Map<string, number>(o.selectors.map(selector => [selector, 0]));
  const take = (selector: string) => hits.set(selector, hits.get(selector)! + 1);
  // Any other selector takes what is equal to it, the name of an instance, the file name of its case or the path of its case: a long list of them is looked up.
  const tried = [...hits.keys()].filter(s => s.includes("*") || s.endsWith("/")).map(s => ({ s, matches: matcher(s) }));
  const taken: Fact[] = [];
  for (const fact of all) {
    let selected = hits.size === 0;
    const caseName = fact.casePath.slice(fact.casePath.lastIndexOf("/") + 1);
    for (const key of new Set([fact.name, caseName, fact.casePath])) {
      if (!hits.has(key)) continue;
      take(key);
      selected = true;
    }
    for (const { s, matches } of tried) {
      if (!matches(fact)) continue;
      take(s);
      selected = true;
    }
""",
    ),
    (
        "  return { taken, empty: matchers.filter(m => m.taken === 0).map(m => m.selector) };\n",
        "  return { taken, empty: [...hits].filter(([, n]) => n === 0).map(([selector]) => selector) };\n",
    ),
]

sweep += [
    (
        "  const mayEnter = reportText(planned, updateCommand(argv, checked.binary));\n",
        "  // The command that adds names holds instances against the lists: it is the command of this run without --each.\n  const command = updateCommand(\n    argv.filter(a => a !== \"--each\"),\n    checked.binary,\n  );\n  const mayEnter = reportText(planned, command);\n",
    ),
]

edit(f"{home}/sweep.ts", sweep)
edit(
    f"{home}/runner/expectations.ts",
    [
        (
            '  "--jobs",\n  "--timeout",\n  "--kind",\n',
            '  "--jobs",\n  "--timeout",\n  "--shard",\n  "--resume",\n  "--kind",\n',
        )
    ],
)
print(f"sweep tool laid over {tree}{' (glue)' if glue else ''}")
