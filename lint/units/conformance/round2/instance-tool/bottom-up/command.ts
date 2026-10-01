// What the commands sweep.ts and instances.ts share: the words of a command line, its check, its selectors, the corpus with the paths of its cases, and a run with files.
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSpawnCheck } from "./check_bun_lint";
import { type Corpus, caseBaseName, listCases, openCorpus } from "./corpus";
import { makeTemporaryDirectory } from "./materialise";
import { corpusPaths } from "./paths";
import { type Check, type Instance, type RunResult, outcomes, runInstances } from "./run";

// The command line is wrong.
export class UsageError extends Error {}
// A file that a command reads or writes is not there or is not what it has to be.
export class FileError extends Error {}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The words of a command line in their order. A word that does not start with "-" is a selector. An option is given once; one of `valued` takes its value after "=" or as the next word. `set` gets each option and throws at one that it does not know.
export function readCommandLine(
  argv: readonly string[],
  valued: ReadonlySet<string>,
  set: (name: string, value: string | undefined) => void,
): { selectors: string[]; seen: Set<string> } {
  const selectors: string[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < argv.length; k++) {
    let name = argv[k];
    if (!name.startsWith("-") || name === "-") {
      if (name === "") throw new UsageError("an empty selector");
      selectors.push(name);
      continue;
    }
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (name.startsWith("--") && eq > 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (seen.has(name)) throw new UsageError(`${name} is given twice`);
    seen.add(name);
    if (valued.has(name)) {
      if (value === undefined) {
        if (k + 1 >= argv.length) throw new UsageError(`${name} needs a value`);
        value = argv[++k];
      }
      if (value === "") throw new UsageError(`${name} needs a value`);
    } else if (value !== undefined) {
      throw new UsageError(`${name} takes no value`);
    }
    set(name, value);
  }
  return { selectors, seen };
}

// The value of an option that counts: "--jobs 4".
export function countOf(name: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !/^[0-9]+$/.test(value) || n < 1 || !Number.isSafeInteger(n)) {
    throw new UsageError(`${name} ${value}: not a whole number of at least 1`);
  }
  return n;
}

// What a command line says of its check.
export interface CheckOptions {
  // --bin: the binary under test of the default check.
  bin: string | undefined;
  // --check: the module whose default export replaces the default check.
  check: string | undefined;
  // False with --no-files: no instance is written to disk.
  files: boolean;
}

// The options of a check that do not go together.
export function refuseCheckOptions(o: CheckOptions): void {
  if (o.bin !== undefined && o.check !== undefined) {
    throw new UsageError("--bin belongs to the default check: it cannot go with --check");
  }
  if (!o.files && o.check === undefined) {
    throw new UsageError("--no-files needs --check: the default check starts a command, which reads files");
  }
}

export interface NamedCheck {
  check: Check;
  // What a command prints for the check: the command of the default check, or the path of the module.
  name: string;
  // The binary under test of the default check.
  binary: string | undefined;
}

// The check of --check, or the default one: it starts the binary with --lint and the files of an instance, after a probe.
export async function checkOf(o: CheckOptions): Promise<NamedCheck> {
  if (o.check === undefined) {
    const binary = resolve(o.bin ?? process.execPath);
    if (!existsSync(binary)) throw new FileError(`--bin ${binary}: no such file`);
    return { check: createSpawnCheck({ command: [binary], env: process.env }), name: `${binary} --lint`, binary };
  }
  const path = resolve(o.check);
  let module: { default?: unknown };
  try {
    module = await import(pathToFileURL(path).href);
  } catch (error) {
    throw new FileError(`--check ${path}: ${messageOf(error)}`);
  }
  if (typeof module.default !== "function") {
    throw new FileError(`--check ${path}: the default export of the module is no function`);
  }
  return { check: module.default as Check, name: path, binary: undefined };
}

export interface OpenedCorpus {
  corpus: Corpus;
  // The paths of the cases below the cases of the corpus, in the order of their code units: the order of a run.
  cases: string[];
  // The path of the case of an instance, or of a case by its file name.
  caseOf(name: string): string | undefined;
}

// The corpus at a root. It throws FileError where the corpus cannot be read or two of its cases have one name.
export function openCases(corpusRoot: string): OpenedCorpus {
  let cases: string[];
  let corpus: Corpus;
  try {
    cases = listCases(corpusPaths(corpusRoot).cases);
    corpus = openCorpus(corpusRoot);
  } catch (error) {
    throw new FileError(`the corpus at ${corpusRoot} cannot be read: ${messageOf(error)}`);
  }
  // The name of an instance says which case it is of: the reference, too, stops where two cases have one name.
  const byBaseName = new Map<string, string>();
  for (const path of cases) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const other = byBaseName.get(base);
    if (other !== undefined) throw new FileError(`the corpus has two cases of one name: ${other} and ${path}`);
    byBaseName.set(base, path);
  }
  return { corpus, cases, caseOf: name => byBaseName.get(name) ?? byBaseName.get(caseBaseName(name)) };
}

// What a selector reads of an instance.
export interface Selectable {
  // The configured name: "abstractProperty(target=es2015).ts".
  name: string;
  // The suite of the case and the directories below it: "conformance/types/tuple".
  directory: string;
  // The path of the case below the cases of the corpus: "conformance/types/tuple/castingTuple.ts".
  casePath: string;
}

// A pattern is for the names of instances: "*" stands for any characters.
export function isPattern(selector: string): boolean {
  return selector.includes("*");
}

// A pattern; a directory with everything below it, which ends in "/"; the path of a case; the name of an instance or the file name of a case.
export function matcher(selector: string): (fact: Selectable) => boolean {
  if (isPattern(selector)) {
    const parts = selector.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`^${parts.join(".*")}$`, "s");
    return fact => pattern.test(fact.name);
  }
  if (selector.endsWith("/")) return fact => `${fact.directory}/`.startsWith(selector);
  if (selector.includes("/")) return fact => fact.casePath === selector;
  return fact => fact.name === selector || fact.casePath.endsWith(`/${selector}`);
}

export interface Selection<T> {
  // In the order in which the instances were given, each once.
  taken: T[];
  // The selectors that took no instance.
  empty: string[];
}

// The instances that a selector takes and that `keep` leaves; without a selector, every instance that it leaves. A selector whose instances `keep` drops took them.
export function select<T extends Selectable>(
  all: Iterable<T>,
  selectors: readonly string[],
  keep: (fact: T) => boolean = () => true,
): Selection<T> {
  const matchers = selectors.map(selector => ({ selector, matches: matcher(selector), taken: 0 }));
  const taken: T[] = [];
  for (const fact of all) {
    let selected = matchers.length === 0;
    for (const m of matchers) {
      if (!m.matches(fact)) continue;
      m.taken++;
      selected = true;
    }
    if (selected && keep(fact)) taken.push(fact);
  }
  return { taken, empty: matchers.filter(m => m.taken === 0).map(m => m.selector) };
}

// The cases that selectors can take an instance of, none of which is a pattern: the names of instances are not known before a case is read.
export function casesOfSelectors(
  selectors: readonly string[],
  cases: readonly string[],
  caseOf: (name: string) => string | undefined,
): Set<string> {
  const wanted = new Set<string>();
  for (const selector of selectors) {
    if (selector.endsWith("/")) {
      for (const path of cases) if (path.startsWith(selector)) wanted.add(path);
    } else {
      const path = selector.includes("/") ? selector : caseOf(selector);
      if (path !== undefined) wanted.add(path);
    }
  }
  return wanted;
}

// The selectors that took no instance, as a message names them: a directory that lacks its "/" is told so.
export function namesOfEmpty(empty: readonly string[], cases: readonly string[]): string {
  const isDirectory = (selector: string) => cases.some(path => path.startsWith(`${selector}/`));
  return empty.map(s => (isDirectory(s) ? `${s} (a directory ends in "/")` : s)).join(", ");
}

// The selectors of a list: one on a line; an empty line and a line that starts with "#" are none. A line that instances.ts printed gives the name that follows its outcome. It throws at a line of another form.
export function selectorsOfLines(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].trim();
    if (line === "" || line.startsWith("#")) continue;
    const words = line.split(/\s+/);
    const printed = words.length > 1 && (outcomes as readonly string[]).includes(words[0]);
    if (!printed && words.length > 1) throw new Error(`line ${k + 1} holds more than a selector`);
    out.push(printed ? words[1].replace(/:$/, "") : words[0]);
  }
  return out;
}

export interface CorpusRunOptions {
  // True: each instance is written below a new directory of temporary files, which is removed after the last one.
  files: boolean;
  // Instances in flight.
  jobs: number;
  // Limit of one instance.
  timeoutMs: number;
  // Called once for each instance when its outcome is known.
  onResult?(result: RunResult): void;
}

// Instances of a corpus through a check, with the progress on stderr: results in the order of the instances.
export async function runOnCorpus(
  corpus: Corpus,
  instances: readonly Instance[],
  check: Check,
  o: CorpusRunOptions,
): Promise<RunResult[]> {
  const directory = o.files && instances.length > 0 ? makeTemporaryDirectory("bun-lint-sweep-") : undefined;
  try {
    let done = 0;
    return await runInstances(instances, check, {
      input: (instance, root) => corpus.input(instance, root),
      oracle: instance => corpus.oracle(instance),
      directory,
      concurrency: o.jobs,
      timeoutMs: o.timeoutMs,
      onResult(result) {
        o.onResult?.(result);
        done++;
        if (!process.stderr.isTTY) {
          if (done % 2000 === 0) console.error(`${done} of ${instances.length}`);
        } else if (done % 50 === 0 || done === instances.length) {
          process.stderr.write(`\r${done} of ${instances.length}${done === instances.length ? "\n" : ""}`);
        }
      },
    });
  } finally {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
}
