// Where a project has no types of Bun installed, the build brings them, and keeps a type error only if `bun check`, under the project's own view, reports an error at the same place. That second check
// used to read the disk, while the build had read what a plugin's onLoad() gave, or the `files` of Bun.build(): one line more in front and no place agreed, so a real error was dropped and the build
// went through. The second check is given the same texts.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const build = (options: string) => `import { readFileSync } from "node:fs";
import { join } from "node:path";
const onDisk = name => readFileSync(join(import.meta.dir, name), "utf8");
const gives = (filter, write) => [{ name: "gives", setup(build) { build.onLoad({ filter }, args => ({ contents: write(args.path), loader: "ts" })); } }];
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { aot: true, outfile: "./out/program" }, throw: false, ${options} });
console.log("SAID", result.success ? "builds" : "stops", result.logs.some(log => String(log.message).includes("not assignable")));
`;
const wrong = `const count: number = "seven";\nconsole.log(count);\nexport {};\n`;
const right = `const count: number = 7;\nconsole.log(count);\nexport {};\n`;
const onlyWrongUnderTypesOfBun = `const timer: number = setTimeout(() => {}, 0);\nclearTimeout(timer);\nexport {};\n`;
const importer = `import { given } from "./other.ts";\nconst count: number = given;\nconsole.log(count);\n`;

const cases: Record<string, { files: Record<string, string>; options: string; said: string }> = {
  "no text is given": { files: { "main.ts": wrong }, options: "", said: "stops true" },
  "a plugin lays a line in front": {
    files: { "main.ts": wrong },
    options: `plugins: gives(/main\\.ts$/, () => "const added = 1;\\n" + onDisk("main.ts"))`,
    said: "stops true",
  },
  "a plugin writes the error": {
    files: { "main.ts": right },
    options: `plugins: gives(/main\\.ts$/, () => onDisk("main.ts").replace("= 7", '= "seven"'))`,
    said: "stops true",
  },
  "a plugin takes the error out": {
    files: { "main.ts": wrong },
    options: `plugins: gives(/main\\.ts$/, () => onDisk("main.ts").replace('"seven"', "7"))`,
    said: "builds false",
  },
  "a plugin changes a file, and the error stands in the file that imports it": {
    files: { "main.ts": importer, "other.ts": `export const given: number = 1;\n` },
    options: `plugins: gives(/other\\.ts$/, () => 'export const given: string = "seven";\\n')`,
    said: "stops true",
  },
  "what is an error under the types of Bun alone stops no build behind a line in front": {
    files: { "main.ts": onlyWrongUnderTypesOfBun },
    options: `plugins: gives(/main\\.ts$/, () => "const added = 1;\\n" + onDisk("main.ts"))`,
    said: "builds false",
  },
  "the files of Bun.build() lay a line in front": {
    files: { "main.ts": wrong },
    options: `files: { [join(import.meta.dir, "main.ts")]: "const added = 1;\\n" + onDisk("main.ts") }`,
    said: "stops true",
  },
  "the files of Bun.build() hold a file that is not on disk": {
    files: { "main.ts": importer },
    options: `files: { [join(import.meta.dir, "other.ts")]: 'export const given: string = "seven";\\n' }`,
    said: "stops true",
  },
};

for (const [name, { files, options, said }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("aot-a-type-error-in-a-text-that-the-build-was-given", {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "lib": ["ESNext", "DOM"], "module": "Preserve" } }\n`,
      "build.mjs": build(options),
      ...files,
    });
    const { stdout, exitCode } = await run([bunExe(), "build.mjs"], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: `SAID ${said}\n`, exitCode: 0 });
  });
}
