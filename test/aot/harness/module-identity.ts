// For module-identity-*.test.ts. Each case of module-identity-cases.ts and module-identity-held-cases.ts is a project of its own. It runs under `bun test` and under `bun test --aot`, each run in a folder and a process
// of its own: beside other cases most of what goes wrong here looks right. What `bun test` says is the specification: the SAID lines, how each test ends, the counts and the exit code.
//
// ../module-identity.known.txt has one line for each case whose compiled run is not yet what it should be:
//   <variant> | <case> | <class> | <first column that differs> | <number of columns that differ>
//   reported            The answer differs and the compiled run says so: it prints a notice that names the file whose columns are printed, or an error line that `bun test` does not print.
//   reported elsewhere  The answer differs, and no notice names that file.
//   silent              The answer differs and nothing says so.
//   needless notice     The answer is the same and the run prints a notice anyway, so the line names no column. Not for `looped` and `shared` cases: every compiled run of those prints a warning.
// A case fails when its line is not the listed one. So it fails when it was right and now differs, when it was reported and is now silent, when it differs in other columns, and
// when it is listed and has come right. A crash always fails and is never listed. Nor is a `held` case whose answer
//   depends on a cache       Three reads of one property differ within a line, or differ from those of the run in which nothing read the property before.
//   depends on a collection  The lines that precede any write through a kept instance differ from those of the run that keeps every instance.
// BUN_AOT_REWRITE_MODULE_IDENTITY=1 rewrites the lines of the cases that ran. Read the diff of the list: a line that turns from `reported` to `silent` is a regression.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { afterAll } from "./default-timeout";
import { moduleIdentityCases, type Case, type Dependence } from "./module-identity-cases";
import { heldNamespaceCases, heldRunsPerProject } from "./module-identity-held-cases";
import { run } from "./run";

const list = join(import.meta.dir, "..", "module-identity.known.txt");
const rewrite = !!process.env.BUN_AOT_REWRITE_MODULE_IDENTITY;
const isEntry = (line: string) => line !== "" && !line.startsWith("#");
const keyOf = (line: string) => line.split(" | ").slice(0, 2).join(" | ");
const classOf = (line: string | undefined) => line?.split(" | ")[2] ?? "same";

const notice = /didn't run again|ran from source|stays loaded|TS1000\d\d/;
/** In the runs of a `held` case that load a file from source, the notices that say so do not say that its values are wrong. */
const heldNotice = /didn't run again|stays loaded/;
const namedFile = /^  (\S+\.(?:mjs|ts))[:,] /;
const error = /(^|\s)error:|^\s*\w*Error:|^warn(ing)?:|[Uu]nhandled/;
const crash =
  /panic|Segmentation fault|Bun has crashed|ASSERTION FAILED|Illegal instruction|SIG(SEGV|ABRT|ILL|TRAP|BUS)|AddressSanitizer|RELEASE_ASSERT|internal error/i;

/** The files in the lists that follow the notices. */
function filesNamed(lines: string[], isNotice: RegExp) {
  const named = new Set<string>();
  let isInList = false;
  for (const line of lines) {
    const file = namedFile.exec(line)?.[1];
    if (file === undefined) isInList = isNotice.test(line);
    else if (isInList) named.add(file);
  }
  return named;
}

async function outcomeOf({ variant, files, args, env: ownEnv }: Case, ...flags: string[]) {
  using dir = tempDir("aot-module-identity", files);
  const env = { ...bunEnv, NO_COLOR: "1", BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "0", ...ownEnv };
  const { stdout, stderr, exitCode } = await run(
    // A case takes up to ten seconds in a sanitizer build, and its one test has the default timeout of five.
    [bunExe(), "test", "--no-install", "--timeout=300000", ...flags, ...args],
    String(dir),
    env,
  );
  // The two runs have folders of their own, and their error lines are compared.
  const linesOf = (text: string) =>
    text
      .replaceAll(dir + "/", "")
      .replaceAll(String(dir), "")
      .replace(/ \[[\d.]+m?s\]/g, "")
      .split("\n");
  const lines = [...linesOf(stderr), ...linesOf(stdout)];
  const isNotice = variant === "held" ? heldNotice : notice;
  const runnerLines = lines.filter(line => !line.startsWith("SAID"));
  const count = (word: string) => lines.find(line => new RegExp(`^\\s*\\d+ ${word}$`).test(line))?.trim();
  return {
    answer: {
      said: lines.filter(line => line.startsWith("SAID")),
      tests: lines.filter(line => /^\((pass|fail|skip|todo)\) /.test(line)),
      counts: [count("pass"), count("fail")],
      exitCode,
    },
    hasNotice: lines.some(line => isNotice.test(line)),
    filesNamed: filesNamed(lines, isNotice),
    errors: runnerLines.filter(line => error.test(line) && !notice.test(line)),
    hasCrashed: exitCode >= 128 || runnerLines.some(line => crash.test(line)),
    lastLines: runnerLines.filter(Boolean).slice(-12),
  };
}

/** Each word after the title of a SAID line is a column: `<name>=<values>`, the bodies that have run (`@..`, named by its position), or a word of an error message. */
const columnsOf = (said: string[]) =>
  said.flatMap(line => {
    const [, title = "", ...words] = line.split(" ");
    return words.map((word, position) => {
      const name = word.includes("=") ? word.slice(0, word.indexOf("=")) : word.startsWith("@") ? `@${position}` : word;
      return { name: `${title}:${name}`, word };
    });
  });

function differingColumns(plain: string[], compiled: string[]) {
  const [expected, printed] = [columnsOf(plain), columnsOf(compiled)];
  return Array.from({ length: Math.max(expected.length, printed.length) }, (_, at) => ({
    name: (expected[at] ?? printed[at]).name,
    isSame: expected[at]?.name === printed[at]?.name && expected[at]?.word === printed[at]?.word,
    expected: expected[at]?.word ?? "nothing",
    printed: printed[at]?.word ?? "nothing",
  })).filter(column => !column.isSame);
}

/** The columns of one run whose three reads are not the same. */
const unevenReads = (said: string[]) =>
  columnsOf(said)
    .filter(({ word }) => {
      const reads = word.slice(word.indexOf("=") + 1).split(",");
      return reads.length === 3 && new Set(reads).size > 1;
    })
    .map(({ name, word }) => `${name}: ${word}`);

const comparedLines = (said: string[], isCompared: (title: string) => boolean) =>
  said.filter(line => isCompared(line.split(" ")[1] ?? ""));

type Outcome = Awaited<ReturnType<typeof outcomeOf>>;

async function dependencesOf(project: Case, said: string[], outcomeOfOther: (name: string) => Promise<Outcome>) {
  const found: { failure: Dependence; columns: string[] }[] = [];
  if (project.variant !== "held") return found;
  const uneven = unevenReads(said);
  if (uneven.length) found.push({ failure: "depends on a cache", columns: uneven });
  for (const { name, isCompared, failure } of project.agreesWith ?? []) {
    const other = await outcomeOfOther(name);
    const columns = differingColumns(comparedLines(other.answer.said, isCompared), comparedLines(said, isCompared)).map(
      column => `${column.name}: ${column.printed} | ${name} ${column.expected}`,
    );
    if (columns.length) found.push({ failure, columns });
  }
  return found;
}

/** `parts` files share the cases. Neighbors in the list of cases cost about the same, so they are dealt out in turn. */
export function moduleIdentity(part: number, parts: number) {
  const cases = moduleIdentityCases();
  judge(
    cases.filter((_, index) => index % parts === part - 1),
    [...cases, ...heldNamespaceCases()],
    part === 1,
  );
}

/** As moduleIdentity(). The runs of a project are in one file, because they are compared with each other. */
export function heldNamespaces(part: number, parts: number) {
  const cases = heldNamespaceCases();
  judge(
    cases.filter((_, index) => Math.floor(index / heldRunsPerProject) % parts === part - 1),
    [...moduleIdentityCases(), ...cases],
    false,
  );
}

function judge(cases: Case[], allCases: Case[], checksList: boolean) {
  const keyOfCase = ({ variant, name }: Pick<Case, "variant" | "name">) => `${variant} | ${name}`;
  const keys = new Set(allCases.map(keyOfCase));
  const caseOf = new Map(cases.map(project => [keyOfCase(project), project]));
  const outcomes = new Map<string, Promise<Outcome>>();
  /** A case that another one is compared with runs once. */
  function outcomeOnce(project: Case, ...flags: string[]) {
    const key = [keyOfCase(project), ...flags].join(" | ");
    let outcome = outcomes.get(key);
    if (!outcome) outcomes.set(key, (outcome = outcomeOf(project, ...flags)));
    return outcome;
  }
  const known = new Map(
    readFileSync(list, "utf8")
      .split("\n")
      .filter(isEntry)
      .map(line => [keyOf(line), line]),
  );
  const judged = new Map<string, string | undefined>();

  if (checksList && !rewrite)
    test("every listed case exists", () => {
      expect([...known.keys()].filter(key => !keys.has(key))).toEqual([]);
    });

  for (const project of cases) {
    const key = keyOfCase(project);
    test.concurrent(key, async () => {
      const [plain, compiled] = await Promise.all([outcomeOnce(project), outcomeOnce(project, "--aot")]);
      // A project that prints nothing under `bun test` would pass for the wrong reason.
      expect({ said: plain.answer.said.length > 0, hasCrashed: plain.hasCrashed }).toEqual({
        said: true,
        hasCrashed: false,
      });
      if (compiled.hasCrashed)
        throw new Error(`${key}: crashed with exit code ${compiled.answer.exitCode}\n${compiled.lastLines.join("\n")}`);

      const dependencesUnder = (said: string[], ...flags: string[]) =>
        dependencesOf(project, said, name =>
          outcomeOnce(caseOf.get(keyOfCase({ variant: project.variant, name }))!, ...flags),
        );
      expect(await dependencesUnder(plain.answer.said)).toEqual([]);
      const dependences = await dependencesUnder(compiled.answer.said, "--aot");
      if (dependences.length)
        throw new Error(
          dependences
            .flatMap(({ failure, columns }) => [`${key}: ${failure}`, ...columns.slice(0, 12).map(line => "  " + line)])
            .join("\n"),
        );

      const differing = differingColumns(plain.answer.said, compiled.answer.said);
      const howReported =
        compiled.filesNamed.has(project.subject) || compiled.errors.some(line => !plain.errors.includes(line))
          ? "reported"
          : compiled.hasNotice
            ? "reported elsewhere"
            : "silent";
      const alwaysHasNotice = project.variant === "looped" || project.variant === "shared";
      const found = !Bun.deepEquals(plain.answer, compiled.answer)
        ? [key, howReported, differing[0]?.name ?? "tests or exit code", differing.length].join(" | ")
        : compiled.hasNotice && !alwaysHasNotice
          ? `${key} | needless notice`
          : undefined;
      judged.set(key, found);
      if (rewrite) return;

      const listed = known.get(key);
      if (found !== listed)
        console.error(
          [
            `${key}: was ${classOf(listed)}, is ${classOf(found)}`,
            ...differing
              .slice(0, 12)
              .map(column => `  ${column.name}: bun test ${column.expected} | --aot ${column.printed}`),
          ].join("\n"),
        );
      expect(found ?? `${key} | same`).toBe(listed ?? `${key} | same`);
    });
  }

  afterAll(() => {
    if (!rewrite) return;
    const lines = readFileSync(list, "utf8").split("\n");
    const others = lines.filter(line => isEntry(line) && keys.has(keyOf(line)) && !judged.has(keyOf(line)));
    const entries = [...others, ...[...judged.values()].filter(line => line !== undefined)].sort();
    writeFileSync(list, [...lines.filter(line => line.startsWith("#")), ...entries, ""].join("\n"));
  });
}
