// Prototype of the command line of sweep.ts and of the selection of instances.
import type { InstanceFacts, Kind, Level } from "./expectations";

export const usage = `usage: bun test/cli/lint/conformance/sweep.ts [options] [selector ...]

An instance is swept when one selector takes it. Without a selector every instance is swept.
  compiler/   conformance/types/tuple/    a directory of the cases with everything below it; it ends in "/"
  conformance/types/tuple/castingTuple.ts the instances of the case at that path
  castingTuple.ts                         the instances of the case with that file name, and the instance of that name
  "abstractProperty(target=es2015).ts"    the instance of that name
  "abstract*"                             the instances whose name matches; "*" stands for any characters

  --bin <path>           binary under test of the default check (default: the binary that runs this script)
  --check <module>       module whose default export is a check; it replaces the default check
  --level <level>        baseline or first-section (default: the level of expectations.json when the check reaches it)
  --jobs <n>             instances in flight (default: the number of processors)
  --timeout <ms>         limit of one instance (default: 60000)
  --listed               only the instances that expectations.json lists
  --kind <E|C>           only the instances of that kind
  --tag <tag>            only the instances with that tag: accepted, triaged, post-emit-order
  --update               add to expectations.json the names that pass, are not listed and may enter
  --report <path>        file of the report (default: lint-conformance-report.json in the temporary directory)
  --since <revision>     compare the lists with expectations.json of that revision: a removed name fails
  --no-run               run no instance: check the lists against the corpus, and --since
  --expectations <path>  the lists (default: expectations.json beside this script)
  --corpus <directory>   the corpus (default: corpus beside this script)
  --reference <path>     a clone of typescript-go with its submodule, in place of the corpus
  -h, --help

Exit code 0: every listed instance of the selection passes and no name was removed. 1: not so. 2: the command line is wrong.
`;

export interface SweepOptions {
  selectors: string[];
  bin: string | undefined;
  check: string | undefined;
  level: Level | undefined;
  jobs: number | undefined;
  timeoutMs: number;
  listed: boolean;
  kind: Kind | undefined;
  tag: string | undefined;
  update: boolean;
  report: string | undefined;
  since: string | undefined;
  run: boolean;
  expectations: string | undefined;
  corpus: string | undefined;
  reference: string | undefined;
  help: boolean;
}

export class UsageError extends Error {}

const valued = new Set(["--bin", "--check", "--level", "--jobs", "--timeout", "--kind", "--tag", "--report", "--since", "--expectations", "--corpus", "--reference"]);
const tags = ["accepted", "triaged", "post-emit-order"];

export function parseSweepArgs(argv: readonly string[]): SweepOptions {
  const o: SweepOptions = {
    selectors: [], bin: undefined, check: undefined, level: undefined, jobs: undefined, timeoutMs: 60_000, listed: false, kind: undefined,
    tag: undefined, update: false, report: undefined, since: undefined, run: true, expectations: undefined, corpus: undefined, reference: undefined, help: false,
  };
  const seen = new Set<string>();
  for (let k = 0; k < argv.length; k++) {
    let a = argv[k];
    if (!a.startsWith("-") || a === "-") {
      if (a === "") throw new UsageError("an empty selector");
      o.selectors.push(a);
      continue;
    }
    let value: string | undefined;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      value = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (seen.has(a)) throw new UsageError(`${a} is given twice`);
    seen.add(a);
    if (valued.has(a)) {
      if (value === undefined) {
        if (k + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
        value = argv[++k];
      }
      if (value === "") throw new UsageError(`${a} needs a value`);
    } else if (value !== undefined) {
      throw new UsageError(`${a} takes no value`);
    }
    const count = (min: number) => {
      if (!/^[0-9]+$/.test(value!) || Number(value) < min || !Number.isSafeInteger(Number(value))) throw new UsageError(`${a} ${value}: not a whole number of at least ${min}`);
      return Number(value);
    };
    switch (a) {
      case "--bin": o.bin = value; break;
      case "--check": o.check = value; break;
      case "--level":
        if (value !== "baseline" && value !== "first-section") throw new UsageError(`--level ${value}: baseline or first-section`);
        o.level = value;
        break;
      case "--jobs": o.jobs = count(1); break;
      case "--timeout": o.timeoutMs = count(1); break;
      case "--kind":
        if (value !== "E" && value !== "C") throw new UsageError(`--kind ${value}: E or C`);
        o.kind = value;
        break;
      case "--tag":
        if (!tags.includes(value!)) throw new UsageError(`--tag ${value}: one of ${tags.join(", ")}`);
        o.tag = value;
        break;
      case "--report": o.report = value; break;
      case "--since": o.since = value; break;
      case "--expectations": o.expectations = value; break;
      case "--corpus": o.corpus = value; break;
      case "--reference": o.reference = value; break;
      case "--listed": o.listed = true; break;
      case "--update": o.update = true; break;
      case "--no-run": o.run = false; break;
      case "-h":
      case "--help": o.help = true; break;
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  if (o.bin !== undefined && o.check !== undefined) throw new UsageError("--bin belongs to the default check: it cannot go with --check");
  if (o.corpus !== undefined && o.reference !== undefined) throw new UsageError("--corpus and --reference exclude each other");
  if (!o.run && o.update) throw new UsageError("--update needs a run: it cannot go with --no-run");
  if (!o.run && (o.bin ?? o.check ?? o.level ?? o.jobs) !== undefined) throw new UsageError("--no-run runs no instance: --bin, --check, --level and --jobs have no use");
  return o;
}

function matcher(selector: string): (i: InstanceFacts) => boolean {
  if (selector.includes("*")) {
    const re = new RegExp("^" + selector.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "s");
    return i => re.test(i.name);
  }
  if (selector.endsWith("/")) {
    const d = selector.slice(0, -1);
    return i => i.directory === d || i.directory.startsWith(selector);
  }
  if (selector.includes("/")) return i => i.casePath === selector;
  return i => i.name === selector || i.casePath.slice(i.casePath.lastIndexOf("/") + 1) === selector;
}

export interface Selection {
  instances: InstanceFacts[];
  // selectors that took no instance: a usage error
  empty: string[];
}

export function select(all: readonly InstanceFacts[], o: Pick<SweepOptions, "selectors" | "listed" | "kind" | "tag">, listed: ReadonlySet<string>): Selection {
  const ms = o.selectors.map(s => ({ s, m: matcher(s), n: 0 }));
  const instances: InstanceFacts[] = [];
  for (const i of all) {
    let taken = ms.length === 0;
    for (const x of ms) if (x.m(i)) { x.n++; taken = true; }
    if (!taken) continue;
    if (o.listed && !listed.has(i.name)) continue;
    if (o.kind !== undefined && i.kind !== o.kind) continue;
    if (o.tag !== undefined && !i.tags.includes(o.tag)) continue;
    instances.push(i);
  }
  return { instances, empty: ms.filter(x => x.n === 0).map(x => x.s) };
}

// The command that a report prints: the command line of this run with --update.
export function updateCommand(argv: readonly string[], binaryOfDefaultCheck?: string): string {
  const quote = (a: string) => (/^[A-Za-z0-9_\/.,:=@%+-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`);
  const rest = argv.filter(a => a !== "--update");
  const named = rest.some(a => a === "--bin" || a.startsWith("--bin=") || a === "--check" || a.startsWith("--check="));
  // the binary that ran this script may not be the one that runs the printed command
  const bin = !named && binaryOfDefaultCheck !== undefined ? ["--bin", binaryOfDefaultCheck] : [];
  return ["bun", "test/cli/lint/conformance/sweep.ts", ...[...bin, ...rest].map(quote), "--update"].join(" ");
}
