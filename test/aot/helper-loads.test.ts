// A helper that lies beside the tests, not below them, loads what a test names: `export const load = path => import(path)` in support/.
// Nothing but the files of the tests imports it, in the run or on disk, so no executable holds it, and it loads as under plain `bun test`.
// Where another file of the project imports it, reached by the run or not, it is the product's and finds compiled files alone, as in the executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const doors: Record<string, string> = {
  imports: `export const load = (path: string) => import(path);`,
  joins: `import { basename, dirname, join } from "node:path";\nexport const load = (path: string) => import(join(dirname(path), basename(path)));`,
  requires: `export const load = async (path: string) => require(path);`,
  makesRequire: `import { createRequire } from "node:module";\nconst need = createRequire(import.meta.url);\nexport const load = async (path: string) => need(path);`,
  metaRequires: `export const load = async (path: string) => import.meta.require(path);`,
  globs: `import { dirname, join } from "node:path";\nexport const load = async (path: string) => { const folder = dirname(path); for (const name of new Bun.Glob("*").scanSync(folder)) if (join(folder, name) === path) return import(join(folder, name)); };`,
};
const names = Object.keys(doors);

const places = {
  "beside the tests": { helpers: "support", tests: "tests", spelled: "../support" },
  "above the tests": { helpers: "shared", tests: "app/tests", spelled: "../../shared" },
  "in a package of the workspace": { helpers: "packages/kit", tests: "tests", spelled: "kit" },
};

function project(place: keyof typeof places, throughBarrel: boolean, more: Record<string, string> = {}) {
  const { helpers, tests, spelled } = places[place];
  const isPackage = spelled === "kit";
  const up = tests.split("/").map(() => "..");
  const files: Record<string, string> = {
    "package.json": `{ "name": "p", "type": "module"${isPackage ? `, "workspaces": ["packages/*"]` : ""} }`,
    [`${tests}/a.test.ts`]: `
      import { test } from "bun:test";
      import { join } from "node:path";
      ${throughBarrel ? `import { ${names.join(", ")} } from "${isPackage ? spelled : spelled + "/index"}";` : names.map(name => `import { load as ${name} } from "${spelled}/${name}";`).join("\n")}
      const loaders: Record<string, (path: string) => Promise<any>> = { ${names.join(", ")} };
      for (const [name, load] of Object.entries(loaders))
        test(name, async () => {
          try {
            const loaded = await load(join(import.meta.dir, ${up.map(it => JSON.stringify(it)).join(", ")}, "src", ["of", name].join("-") + ".ts"));
            console.log("SAID", name, loaded.increment(), loaded.unused());
          } catch (error) {
            console.log("SAID", name, "REFUSED", String((error as Error).message).split(": ")[1]?.split(",")[0]);
          }
        });`,
    ...more,
  };
  for (const name of names) {
    files[`${helpers}/${name}.ts`] = doors[name];
    files[`src/of-${name}.ts`] =
      `let count = 0;\nexport function increment(): number { return ++count; }\nexport function unused(): string { return "unused"; }`;
  }
  if (throughBarrel || isPackage)
    files[`${helpers}/index.ts`] = names.map(name => `export { load as ${name} } from "./${name}";`).join("\n");
  if (isPackage)
    files[`${helpers}/package.json`] =
      `{ "name": "kit", "type": "module", "exports": { ".": "./index.ts", "./*": "./*.ts" } }`;
  return files;
}

function lay(name: string, files: Record<string, string>) {
  const directory = tempDir(name, { ...files, "node_modules/.keep": "" });
  if ("packages/kit/package.json" in files)
    symlinkSync("../packages/kit", join(String(directory), "node_modules", "kit"), "junction");
  return directory;
}

async function testRun(directory: string, flags: string[], words = "", files: string[] = []) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...files], directory, {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_DEBUG_TEST_AOT_WORDS: words,
  });
  const lines = (stdout + "\n" + stderr).split("\n");
  return {
    said: lines.filter(line => line.startsWith("SAID ")).sort(),
    why: lines.filter(line => line.includes("is part of your program")).map(line => line.trim()),
    exitCode,
  };
}

const forms = [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2"],
] as const;
const loaded = { said: names.map(name => `SAID ${name} 1 unused`).sort(), why: [], exitCode: 0 };
const refused = names.map(name => `SAID ${name} REFUSED it wasn't compiled with the program`).sort();

for (const [index, place] of (Object.keys(places) as (keyof typeof places)[]).entries())
  for (const throughBarrel of [false, true])
    test.concurrent(
      `a helper ${place}, imported ${throughBarrel ? "through a file that exports it again" : "by a statement"}, loads what the test names`,
      async () => {
        using directory = lay("helper-loads", project(place, throughBarrel));
        expect(await testRun(String(directory), [])).toEqual(loaded);
        for (const [, words] of waysFor(forms, index === 0 && throughBarrel))
          expect(await testRun(String(directory), ["--aot"], words)).toEqual(loaded);
      },
    );

const importers: [name: string, file: string, text: (name: string) => string, isProduct: boolean][] = [
  [
    "the entry of the product, which no test imports",
    "main.ts",
    name => `import { load } from "./support/${name}";\nconsole.log(typeof load);`,
    true,
  ],
  [
    "a script that nothing imports",
    "scripts/try.ts",
    name => `import { load } from "../support/${name}.ts";\nvoid load;`,
    true,
  ],
  [
    "a file that makes a require of its own",
    "main.ts",
    name =>
      `import { createRequire } from "node:module";\nvoid createRequire(import.meta.url)("./support/${name}.ts");`,
    true,
  ],
  [
    "a file that exports it again, and the entry imports that",
    "lib/again.ts",
    name => `export { load } from "../support/${name}";`,
    true,
  ],
  [
    "a file that exports it again, and nothing imports that",
    "support/all.ts",
    name => `export { load } from "./${name}";`,
    false,
  ],
  [
    "a test file that this run leaves out",
    "other/b.test.ts",
    name => `import { load } from "../support/${name}";\ntest("b", () => void load);`,
    false,
  ],
  [
    "a file beside a test file that this run leaves out",
    "other/kit.ts",
    name => `import { load } from "../support/${name}";\nvoid load;`,
    false,
  ],
  [
    "a file that takes something from the test runner",
    "stubs/stub.ts",
    name =>
      `import { mock } from "bun:test";\nimport { load } from "../support/${name}";\nexport const stub = mock(load);`,
    false,
  ],
  [
    "a package",
    "node_modules/other/index.js",
    name => `import { load } from "../../support/${name}.ts";\nvoid load;`,
    false,
  ],
  ["a comment", "notes.ts", name => `// import { load } from "./support/${name}";\nexport {};`, false],
];

for (const [name, file, text, isProduct] of importers)
  test.concurrent(
    `a helper that ${name} ${name === "a comment" ? "names" : "imports"} is ${isProduct ? "the product's" : "the tests'"}`,
    async () => {
      const more: Record<string, string> = { [file]: text("imports") };
      if (file === "lib/again.ts") more["main.ts"] = `import { load } from "./lib/again";\nvoid load;`;
      if (file === "other/kit.ts") more["other/b.test.ts"] = `test("b", () => {});`;
      using directory = lay("helper-loads-importer", project("beside the tests", false, more));
      expect(await testRun(String(directory), [], "", ["./tests"])).toEqual(loaded);
      const said = isProduct
        ? loaded.said.map(line =>
            line.startsWith("SAID imports ") ? refused[names.slice().sort().indexOf("imports")] : line,
          )
        : loaded.said;
      const importer = file === "lib/again.ts" ? "main.ts" : file;
      const why = isProduct
        ? [`support/imports.ts is part of your program: ${importer} imports it, and that's no file of your tests.`]
        : [];
      for (const [, words] of waysFor(forms, file === "main.ts" || file === "other/b.test.ts"))
        expect(await testRun(String(directory), ["--aot"], words, ["./tests"])).toEqual({ said, why, exitCode: 0 });
    },
  );

test.concurrent("what package.json names as a way into the project is the product's", async () => {
  const files = project("beside the tests", false);
  files["package.json"] =
    `{ "name": "p", "type": "module", "main": "./support/imports.ts", "bin": { "p": "support/requires.ts" } }`;
  using directory = lay("helper-loads-entry", files);
  expect(await testRun(String(directory), [])).toEqual(loaded);
  const said = loaded.said.map(line =>
    /^SAID (imports|requires) /.test(line)
      ? `SAID ${line.split(" ")[1]} REFUSED it wasn't compiled with the program`
      : line,
  );
  for (const [, words] of waysFor(forms, false))
    expect(await testRun(String(directory), ["--aot"], words)).toEqual({ said, why: [], exitCode: 0 });
});
