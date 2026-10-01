// One line for each instance that the selectors take: pass, or the first line at which the baseline of its diagnostics parts from the oracle.
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import {
  type CheckOptions,
  type CorpusFacts,
  type Kind,
  type Outcome,
  FileError,
  UsageError,
  casesOfSelectors,
  checkOf,
  countOf,
  isPattern,
  messageOf,
  namesOfEmpty,
  openCases,
  outcomes,
  readCommandLine,
  refuseCheckOptions,
  resultLine,
  runOnCorpus,
  select,
  selectorsOfLines,
} from "./runner";

const usage = `usage: bun test/cli/lint/conformance/instances.ts [options] <selector> ...

One line on stdout for each instance that a selector takes, in the order of the corpus whatever the order of the
selectors: the cases by their paths, the instances of a case as the reference numbers them.
  pass <name>
  fail <name>: line <n>: - <line of the oracle> + <line of the baseline>   the first line that differs; each a JSON string
  fail <name>: line 1: - <first line of the oracle>                        the check reports no diagnostic
  fail <name>: line 1: + <first line of the baseline>                      the oracle has no diagnostic
  <outcome> <name>: <reason>                                               a fail of another kind, skip, provisional,
                                                                           unavailable, unsupported, crash, timeout
The comparison is that of sweep.ts, byte for byte. The progress and the counts go to stderr; no file is written, and
expectations.json is neither read nor written: sweep.ts --update adds the names that pass.

A selector:
  compiler/   conformance/types/tuple/    a directory of the cases with everything below it; it ends in "/"
  conformance/types/tuple/castingTuple.ts the instances of the case at that path
  castingTuple.ts                         the instances of the case with that file name, and the instance of that name
  "abstractProperty(target=es2015).ts"    the instance of that name
  "abstract*"                             the instances whose name matches; "*" stands for any characters

  --names <file>         more selectors, one on a line; "-" is stdin. Of a line that this command printed, the name
  --bin <path>           binary under test of the default check, which runs it with --lint and the files of an
                         instance (default: the binary that runs this script)
  --check <module>       module whose default export is a check; it replaces the default check
  --no-files             write no instance to disk; with --check, for a check that reads the units of its input
  --jobs <n>             instances in flight (default: 4, or the number of processors where that is less)
  --timeout <ms>         limit of one instance (default: 60000)
  --kind <E|C>           only the instances whose oracle has errors (E) or has none (C)
  --corpus <directory>   the corpus (default: corpus beside this script)
  -h, --help

Exit code 0: every instance that was taken passes, but for those that the reference skips. 1: not so. 2: the command
line is wrong, a selector takes no instance, or the corpus, the list of names or the module of the check cannot be used.`;

interface Options extends CheckOptions {
  selectors: string[];
  names: string | undefined;
  jobs: number | undefined;
  timeoutMs: number;
  kind: Kind | undefined;
  corpus: string | undefined;
  help: boolean;
}

const valued = new Set(["--names", "--bin", "--check", "--jobs", "--timeout", "--kind", "--corpus"]);

function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    selectors: [],
    names: undefined,
    bin: undefined,
    check: undefined,
    files: true,
    jobs: undefined,
    timeoutMs: 60_000,
    kind: undefined,
    corpus: undefined,
    help: false,
  };
  const { selectors } = readCommandLine(argv, valued, (name, value) => {
    switch (name) {
      case "--names":
        o.names = value;
        break;
      case "--bin":
        o.bin = value;
        break;
      case "--check":
        o.check = value;
        break;
      case "--no-files":
        o.files = false;
        break;
      case "--jobs":
        o.jobs = countOf(name, value);
        break;
      case "--timeout":
        o.timeoutMs = countOf(name, value);
        break;
      case "--kind":
        if (value !== "E" && value !== "C") throw new UsageError(`--kind ${value}: E or C`);
        o.kind = value;
        break;
      case "--corpus":
        o.corpus = value;
        break;
      case "-h":
      case "--help":
        o.help = true;
        break;
      default:
        throw new UsageError(`unknown option ${name}`);
    }
  });
  o.selectors = selectors;
  if (!o.help) refuseCheckOptions(o);
  return o;
}

async function main(argv: readonly string[]): Promise<number> {
  const o = parseArgs(argv);
  if (o.help) {
    console.log(usage);
    return 0;
  }
  const selectors = o.selectors.slice();
  if (o.names !== undefined) {
    try {
      const text = o.names === "-" ? await Bun.stdin.text() : readFileSync(resolve(o.names), "utf8");
      selectors.push(...selectorsOfLines(text));
    } catch (error) {
      throw new FileError(`--names ${o.names}: ${messageOf(error)}`);
    }
  }
  if (selectors.length === 0) {
    throw new UsageError(
      'no selector: name instances, cases or directories; "compiler/ conformance/" is every instance',
    );
  }
  // What can end the command with the exit code 2 comes before the corpus is read.
  const { check } = await checkOf(o);
  const { corpus, cases, caseOf } = openCases(resolve(o.corpus ?? join(import.meta.dir, "corpus")));

  // Only the cases that a selector can take an instance of are read; a pattern is for the names of instances, which no case has before it is read.
  const wanted = selectors.some(isPattern) ? undefined : casesOfSelectors(selectors, cases, caseOf);
  const facts: CorpusFacts[] = [];
  for (const casePath of cases) {
    if (wanted !== undefined && !wanted.has(casePath)) continue;
    for (const instance of corpus.enumerateCase(casePath)) facts.push(corpus.facts(instance));
  }
  // An instance that does not run has no class: --kind leaves it out.
  const selection = select(facts, selectors, fact => o.kind === undefined || fact.kind === o.kind);
  if (selection.empty.length > 0) throw new UsageError(`no instance for ${namesOfEmpty(selection.empty, cases)}`);
  const instances = selection.taken.map(fact => fact.instance);

  // A line is printed when every line before it is: stdout is in the order of the corpus, whichever check ends first.
  const place = new Map(instances.map((instance, k) => [instance.name, k] as const));
  const lines = new Array<string | undefined>(instances.length);
  const counts = new Map<Outcome, number>();
  let printed = 0;
  await runOnCorpus(corpus, instances, check, {
    files: o.files,
    jobs: o.jobs ?? Math.min(4, availableParallelism()),
    timeoutMs: o.timeoutMs,
    onResult(result) {
      lines[place.get(result.instance.name)!] = resultLine(result);
      counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
      // console.log has written its line when it returns; what process.stdout still holds for a pipe is lost at process.exit.
      while (printed < lines.length && lines[printed] !== undefined) console.log(lines[printed++]);
    },
  });
  const counted = outcomes.filter(outcome => counts.has(outcome)).map(outcome => `${outcome} ${counts.get(outcome)}`);
  console.error(`instances ${instances.length}: ${counted.join(", ")}`);
  // The reference skips an instance that it does not support: such an instance has nothing that it could pass.
  const notPassing = instances.length - (counts.get("pass") ?? 0) - (counts.get("skip") ?? 0);
  return notPassing > 0 ? 1 : 0;
}

let exitCode: number;
try {
  exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError) && !(error instanceof FileError)) throw error;
  console.error(`instances: ${error.message}${error instanceof UsageError ? "\n--help prints the usage" : ""}`);
  exitCode = 2;
}
process.exit(exitCode);
