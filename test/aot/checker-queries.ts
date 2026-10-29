// What the checker answers the compiler, as text. An expectation is a set of lines, because the whole text of a file is not written by hand.
// Consecutive `ordered:` lines must also be printed in that order. Other printed lines may come between them.
// The fixtures lie in ./checker-queries, a folder for each topic, and each test file asks some of the folders.
import { describeCheckerQueries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { tempDir } from "harness";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, test } from "./with-compiler";

/** Which test file asks which folders. */
export const foldersOf = {
  calls: [
    "call-target",
    "constructor-function-parents",
    "contextual-type",
    "inferred-from-use",
    "two-call-signatures",
    "type-arguments",
  ],
  diagnostics: [
    "dead-code",
    "diagnostic-class",
    "exact-optional-of-the-file",
    "javascript-of-a-strict-program",
    "jsdoc-imports",
    "lenient-options",
    "module-options",
    "null-checks-off-alone",
  ],
  "early-errors": ["early-errors"],
  narrowing: ["narrowing", "written-type"],
  shapes: ["class-shape", "enum-access-package", "non-strict-empty-literals", "object-members", "undefined-property"],
  types: ["type-identity", "type-shape"],
};

/**
 * Writes out the wanted ones of the files that the `*.programs` files of a folder hold. A line that begins with four slashes is a mark:
 *
 *   //// <path>                        a file begins. `////! <path>`: one without a newline at its end
 *   ////: <name>                       a piece begins: text that stands in several places. «1» to «9» in it stand for arguments
 *   ////= <name><tab><argument>..      here stands that piece
 */
function unpack(folder: string, isWanted: (name: string) => boolean): string {
  // On Windows this one alone spells each name as the file system does.
  const where = realpathSync.native(String(tempDir(basename(folder), {})));
  process.on("exit", () => rmSync(where, { recursive: true, force: true }));
  const pieces = new Map<string, string>();
  const expand = (body: string, given: string[] = []): string =>
    (given.length ? body.replace(/«(\d)»/g, (_, n) => given[n - 1]) : body).replace(
      /^\/\/\/\/= ([^\n]*)\n/gm,
      (_, use) => {
        const [name, ...passed] = use.split("\t");
        return expand(pieces.get(name)!, passed);
      },
    );
  const files: [name: string, mark: string, body: string][] = [];
  for (const pack of readdirSync(folder).sort()) {
    if (!pack.endsWith(".programs")) continue;
    const text = readFileSync(join(folder, pack), "utf8").replaceAll("\r\n", "\n");
    const marks = [...text.matchAll(/^\/\/\/\/([ !:]) ?([^\n]*)\n/gm)];
    for (const [index, { 0: line, 1: mark, 2: name, index: start }] of marks.entries()) {
      const body = text.slice(start + line.length, marks[index + 1]?.index);
      if (mark === ":") pieces.set(name, body);
      else if (isWanted(name)) files.push([name, mark, body]);
    }
  }
  for (const [name, mark, body] of files) {
    mkdirSync(dirname(join(where, name)), { recursive: true });
    writeFileSync(join(where, name), expand(body).slice(0, mark === "!" ? -1 : undefined));
  }
  writeFileSync(join(where, "tsconfig.json"), JSON.stringify({ extends: join(folder, "tsconfig.json") }));
  return where;
}

/** The folders of one test file, written out. */
export function unpackFolders(folders: string[]): string {
  return unpack(join(import.meta.dir, "checker-queries"), name => folders.includes(name.split("/")[0]));
}

/** The first part of the path of every fixture. */
export function listFolders(): string[] {
  const names = new Set<string>();
  unpack(join(import.meta.dir, "checker-queries"), name => (names.add(name.split("/")[0]), false));
  return [...names].sort();
}

const extensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

export function textLines(path: string, commentPrefix: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line !== "" && !line.startsWith(commentPrefix));
}

function entryPointOf(fixtures: string, expectation: string): string {
  const stem = join(fixtures, expectation.slice(0, -".queries.txt".length));
  const found = extensions.map(extension => `${stem}.${extension}`).filter(path => existsSync(path));
  expect(found).toHaveLength(1);
  return found[0];
}

// A subject can hold ` = ` itself, so the separator is the one after its closing backtick.
function separatorIndex(line: string): number {
  const afterSubject = line.indexOf("` = ");
  return afterSubject === -1 ? line.indexOf(" = ") : afterSubject + 1;
}

function leftOf(line: string): string {
  return line.slice(0, separatorIndex(line));
}

function answerOf(line: string): string {
  return line.slice(separatorIndex(line) + " = ".length);
}

function checkComparison(line: string, printed: string[]): string | undefined {
  const [kind, sides] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)];
  const answers: string[] = [];
  for (const left of sides.split(" <=> ")) {
    const matches = printed.filter(it => leftOf(it) === left);
    if (matches.length !== 1) return `${line}: ${left} occurs ${matches.length} times`;
    answers.push(answerOf(matches[0]));
  }
  if (answers.some(answer => answer.startsWith("gave up"))) return `${line}: ${answers.join(" <=> ")}`;
  const isEqual = answers[0] === answers[1];
  return isEqual === (kind === "same") ? undefined : `${line}: ${answers.join(" <=> ")}`;
}

export function findFailures(expectation: string[], printed: string[]): string[] {
  const lines = new Set(printed);
  const failures: string[] = [];
  let orderedSearchStart = 0;
  for (const line of expectation) {
    if (line.startsWith("ordered: ")) {
      const text = line.slice("ordered: ".length);
      const index = printed.indexOf(text, orderedSearchStart);
      if (index !== -1) orderedSearchStart = index + 1;
      else failures.push(lines.has(text) ? `${line}: printed out of order` : line);
      continue;
    }
    orderedSearchStart = 0;
    if (line.startsWith("absent: ")) {
      if (lines.has(line.slice("absent: ".length))) failures.push(line);
    } else if (line.startsWith("same: ") || line.startsWith("different: ")) {
      const failure = checkComparison(line, printed);
      if (failure) failures.push(failure);
    } else if (!lines.has(line)) {
      failures.push(line);
    }
  }
  return failures;
}

export function testQueries(name: keyof typeof foldersOf) {
  const fixtures = unpackFolders(foldersOf[name]);
  describe("checker queries", () => {
    for (const expectation of [...new Bun.Glob("**/*.queries.txt").scanSync(fixtures)].sort()) {
      test.concurrent(expectation, () => {
        const entry = entryPointOf(fixtures, expectation);
        const one = describeCheckerQueries(entry, 1);
        const eight = describeCheckerQueries(entry, 8);
        expect(eight).toBe(one);
        const failures = findFailures(textLines(join(fixtures, expectation), "#"), one.split("\n"));
        expect({ failures, printed: failures.length ? one.split("\n").slice(0, 3) : [] }).toEqual({
          failures: [],
          printed: [],
        });
      });
    }
  });
}

export type EarlyErrorCase = { text: string; name: string };

function importStatement(extension: string, index: number): string {
  const path = `./cases/${index}.${extension}`;
  return extension === "cjs" ? `require(${JSON.stringify(path)});\n` : `import ${JSON.stringify(path)};\n`;
}

/** The cases that have an early error, each a file of its own. */
export function findRejected(cases: EarlyErrorCase[], extension: string): Set<number> {
  const tree: Record<string, string> = {
    "package.json": JSON.stringify({ type: "module" }),
    [`main.${extension}`]: cases.map((_, index) => importStatement(extension, index)).join(""),
  };
  cases.forEach(({ text }, index) => (tree[`cases/${index}.${extension}`] = text));
  using directory = tempDir("checker-queries-early-errors", tree);
  const printed = describeCheckerQueries(join(String(directory), `main.${extension}`), 0);
  const rejected = new Set<number>();
  for (const [, index] of printed.matchAll(/^cases\/(\d+)\.\w+:\d+ diagnostic TS\d+ = EarlyError /gm)) {
    rejected.add(Number(index));
  }
  return rejected;
}
