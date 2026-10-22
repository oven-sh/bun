// A folder under ./programs runs only because a test file next to this one calls `programs("<folder>")`, or because one file for
// each part calls `programs("<folder>", <part>, <parts>)`. Where that file is missing nothing fails: the programs lie in the
// repository and no run of the tests takes them. So this reads the test files. It builds nothing and needs no compiler.
// The same is asked of everything else under this folder that is split into parts, and of the folders whose entries a test
// file names one by one. A runner that walks its folder needs no such check.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

const here = import.meta.dir;
const read = (path: string) => readFileSync(join(here, path), "utf8");
/** The names in a folder. That of a folder ends in a slash. */
const entriesOf = (folder: string) =>
  readdirSync(join(here, folder), { withFileTypes: true })
    .map(entry => entry.name + (entry.isDirectory() ? "/" : ""))
    .sort();

function* testFilesUnder(folder: string): Generator<string> {
  for (const name of entriesOf(folder)) {
    const path = folder ? `${folder}/${name}` : name;
    if (name.endsWith(".test.ts")) yield path;
    else if (name.endsWith("/") && name !== "node_modules/" && path !== "programs/") yield* testFilesUnder(path.slice(0, -1));
  }
}

const testFiles = new Map(Array.from(testFilesUnder(""), file => [file, read(file)]));

type Call = { file: string; part: number; parts: number };
/** The calls that differ in the part alone, by what they have in common: the folder of the file and the text in front of the part. */
const splitCalls = new Map<string, Call[]>();
const foldersRun = new Set<string>();

for (const [file, text] of testFiles) {
  // Only a function that the file imports from a file near it: many tests hold the text of whole programs.
  const imported = new Set(Array.from(text.matchAll(/^import \{([^}]*)\} from "\.[^"]*";$/gm), ([, names]) => names.split(",").map(name => name.trim())).flat());
  const add = (callee: string, before: string, part: number, parts: number) => {
    if (!imported.has(callee)) return;
    // The parts of a variant have its label in common: each part may be built with a switch of its own.
    const common = callee === "variant" ? (/^"[^"]*", /.exec(before)?.[0] ?? before) : before;
    const shared = `${dirname(file) === "." ? "" : dirname(file) + "/: "}${callee}(${common}`;
    splitCalls.set(shared, [...(splitCalls.get(shared) ?? []), { file, part, parts }]);
  };
  for (const [, callee, before, part, parts] of text.matchAll(/^(?:await |if \(.*\) )?(\w+)\((.*?)(\d+), (\d+)(?:, (?:"[^"]*"|\[[^\]]*\]|\d+))*\);$/gm)) add(callee, before, Number(part), Number(parts));
  if (dirname(file) !== ".") continue;
  for (const [, folder] of text.matchAll(/^programs\("([^"]+)"\);$/gm)) add("programs", `"${folder}", `, 1, 1);
  for (const [, folder] of text.matchAll(/^programs\("([^"]+)"[,)]/gm)) foldersRun.add(folder);
}

const folders = entriesOf("programs")
  .filter(name => name.endsWith("/"))
  .map(name => name.slice(0, -1));

test("every folder of programs has a test file that runs it", () => {
  expect(folders.length).toBeGreaterThan(40);
  expect(folders.filter(folder => !foldersRun.has(folder))).toEqual([]);
});

test("every folder that a test file runs is there", () => {
  expect([...foldersRun].filter(folder => !folders.includes(folder))).toEqual([]);
});

test("what is split into parts has every part once", () => {
  expect(splitCalls.size).toBeGreaterThan(40);
  const wrong: string[] = [];
  for (const [shared, calls] of splitCalls) {
    const totals = [...new Set(calls.map(call => call.parts))].sort((a, b) => a - b);
    if (totals.length > 1) {
      wrong.push(`${shared}..) is split into ${totals.join(" and into ")} parts`);
      continue;
    }
    const first = calls.some(call => call.part === 0) ? 0 : 1;
    for (let part = first; part < first + totals[0]; part++) {
      const files = calls.filter(call => call.part === part).map(call => call.file);
      if (files.length !== 1) wrong.push(`${shared}${part}, ${totals[0]}) is in ${files.length === 0 ? "no test file" : files.join(" and in ")}`);
    }
    for (const call of calls) if (call.part < first || call.part >= first + totals[0]) wrong.push(`${shared}${call.part}, ${call.parts}) in ${call.file} is no part`);
  }
  expect(wrong).toEqual([]);
});

test("a file directly in ./programs is a helper that the top of run-programs.ts lists", () => {
  const listed = read("run-programs.ts").split("\nimport ")[0];
  const files = entriesOf("programs").filter(name => !name.endsWith("/") && name !== "tsconfig.json");
  expect(files.filter(name => !listed.includes(`//   programs/${name} `))).toEqual([]);
});

// The folders whose entries are named one by one. `entry` takes the name out of what lies in the folder. `named` is the text that
// stands for it in one of the files `by`, which are all test files where none is listed.
const namedOneByOne: { folder: string; entry: RegExp; named: (name: string) => string; by?: string[] }[] = [
  { folder: "packages", entry: /^(?!run-packages\.ts$)(.+)\.ts$/, named: name => `\npackages("${name}", ` },
  { folder: "three-ways/made", entry: /^(.+)\.py$/, named: name => `\nmadeCases("${name}"` },
  { folder: "frameworks/apps", entry: /^(.+)\/$/, named: name => `\ntestFramework("${name}");` },
  { folder: "generated/python", entry: /^(?!external-sources-of-typed-objects\.py$)(.+)\.py$/, named: name => `"${name}"`, by: ["generated/python-generators.ts"] },
  { folder: "generated/python", entry: /^(external-sources-of-typed-objects\.py)$/, named: name => `"${name}"`, by: ["external-sources-of-typed-objects.test.ts"] },
  { folder: "impostors-keep-their-fast-paths", entry: /^(.+)\/$/, named: name => `folder: "${name}"`, by: ["impostors-keep-their-fast-paths/rows.ts"] },
  { folder: "react-compiler", entry: /^(?!react-stand-in\/$)(.+)\/$/, named: name => `"${name}"`, by: ["react-compiler.test.ts"] },
  { folder: "real-apps/programs", entry: /^(.+\.ts)$/, named: name => `file: "${name}"`, by: ["real-apps/programs.test.ts"] },
  { folder: "open-layouts", entry: /^(.+\.ts)$/, named: name => `"${name}"`, by: ["open-layouts.test.ts"] },
  { folder: "napi-addon", entry: /^(.+)(?<!\.d)\.ts$/, named: name => `"${name}"`, by: ["napi-addon.test.ts"] },
  { folder: "repeated-builds", entry: /^(.+\.ts)$/, named: name => `"repeated-builds/${name}"`, by: ["repeated-builds.test.ts"] },
];

for (const { folder, entry, named, by } of namedOneByOne) {
  test(`what lies in ./${folder} is named in ${by?.join(", ") ?? "a test file"}`, () => {
    const names = entriesOf(folder).flatMap(name => entry.exec(name)?.[1] ?? []);
    expect(names).not.toBeEmpty();
    const texts = by ? by.map(read) : [...testFiles.values()];
    expect(names.filter(name => !texts.some(text => text.includes(named(name))))).toEqual([]);
  });
}
