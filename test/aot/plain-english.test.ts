import { Glob } from "bun";
import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";

const repository = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(repository, path), "utf8");

// Keep in sync with BANNED in src/aot/report/wording/tests.rs.
const bannedPhrases = [
  "admit",
  "unseen",
  "refuse",
  "refusal",
  "dearer",
  "road",
  "leaves its slot",
  "made at run time",
  "text at run time",
  "evaluates text",
  "evaluating text",
  "stands",
  "the very",
  "goes on",
  "go on",
  "at once",
  "work it out",
  "works it out",
  "works them out",
  "all the same",
  "counts on",
  "brings in",
  "bring in",
  "given",
  "retain",
  "it protects",
  "predicted",
  "written type",
  "type is written",
  "that you wrote",
  "claim",
  "decline",
  "closed program",
  "open program",
];
const banned = new RegExp(
  String.raw`\b(?:${bannedPhrases.join("|").replaceAll(" ", String.raw`[\s*]+`)})(?:s|d|t?ed|t?ing)?\b`,
  "gi",
);

const deletedNames = [
  "--admit",
  "--aot-audit",
  "--aot-type-errors",
  "aotTypeErrors",
  "explain=throws",
  "throws-json",
  "explain=declines",
  "explain=runtime-use",
  "BUN_AOT_TYPE_ERROR_LOG",
  "ERR_RUNTIME_CODE_NOT_ADMITTED",
];
const deleted = new RegExp(deletedNames.join("|"), "g");

const flagsUnrelatedToAot = ["--redirect-warnings", "--test-name-pattern", "--max-concurrency"];

const documentedOptions = {
  CompileBuildOptions: [
    "trim",
    "functionSource",
    "aot",
    "obfuscate",
    "inspector",
    "aotLogTypeMismatches",
    "aotExplain",
  ],
  TrimOptions: ["allow", "locales", "log"],
};

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

function findAll(pattern: RegExp, path: string, text: string, firstLine = 1) {
  return Array.from(
    text.matchAll(pattern),
    match => `${path}:${firstLine + lineAt(text, match.index) - 1}: ${match[0].replace(/[\s*]+/g, " ")}`,
  );
}

test("the docs use no banned phrase", () => {
  const pages = Array.from(
    new Glob("aot*.mdx").scanSync(join(repository, "docs", "bundler")),
    page => `docs/bundler/${page}`,
  );
  expect(pages).toContain("docs/bundler/aot.mdx");
  const snippets = ["compile", "build", "run"].map(command => `docs/snippets/cli/${command}.mdx`);
  expect([...pages.sort(), ...snippets].flatMap(path => findAll(banned, path, read(path)))).toEqual([]);
});

test("--help uses no banned phrase", async () => {
  using dir = tempDir("plain-english", {});
  const found = await Promise.all(
    ["compile", "build", "run", "test", "check"].map(async command => {
      const { stdout, stderr, exitCode } = await run([bunExe(), command, "--help"], String(dir));
      expect(stdout + stderr).toContain("--aot");
      expect(exitCode).toBe(0);
      const help = (stdout + stderr)
        .split("\n")
        .map(line => (flagsUnrelatedToAot.some(flag => line.includes(flag)) ? "" : line))
        .join("\n");
      return [...findAll(banned, `bun ${command} --help`, help), ...findAll(deleted, `bun ${command} --help`, help)];
    }),
  );
  expect(found.flat()).toEqual([]);
});

test("bun.d.ts describes every compile option without a banned phrase", () => {
  const path = "packages/bun-types/bun.d.ts";
  const types = read(path);
  const declarations = Object.entries(documentedOptions).map(([name, options]) => {
    const start = types.indexOf(`  interface ${name} {\n`);
    expect(start).not.toBe(-1);
    return { options, text: types.slice(start, types.indexOf("\n  }\n", start)), firstLine: lineAt(types, start) };
  });
  const undocumented = declarations.flatMap(({ options, text }) =>
    options.filter(option => !text.includes(`*/\n    ${option}?: `)),
  );
  expect(undocumented).toEqual([]);

  const reports = Array.from(/type AotReport =([^;]+);/.exec(types)![1].matchAll(/"([^"]+)"/g), match => match[1]);
  expect(reports).toContain("text");
  expect(reports.filter(report => !declarations[0].text.includes(`* - \`"${report}"\`: `))).toEqual([]);

  expect(declarations.flatMap(({ text, firstLine }) => findAll(banned, path, text, firstLine))).toEqual([]);
});

test("no deleted flag is mentioned", () => {
  const paths = [
    ...Array.from(new Glob("**/*.{md,mdx,json}").scanSync(join(repository, "docs")), path => `docs/${path}`),
    ...Array.from(new Glob("*").scanSync(join(repository, "completions")), path => `completions/${path}`),
    "packages/bun-types/bun.d.ts",
  ];
  expect(paths).toContain("docs/docs.json");
  expect(paths).toContain("completions/bun.zsh");
  expect(paths.sort().flatMap(path => findAll(deleted, path, read(path)))).toEqual([]);
});
