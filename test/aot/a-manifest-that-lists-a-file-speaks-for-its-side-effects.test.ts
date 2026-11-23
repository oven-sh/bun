import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A package says `"sideEffects": false`, or lists the files that have some, and an import of a file that is free of them goes where
// nothing of the file is used. Packages hold more than one manifest: a folder with `{ "type": "module" }`, a copy of the manifest
// beside the built files. Whichever of them, between the file and the folder of the package, lists the file, speaks for it.
// Where the package's own manifest has a name and says nothing, its files have side effects, whatever a manifest further in says.
// Where an import names a folder whose own manifest points at the file by "main", that manifest speaks, as in `bun build`.
const app = { "package.json": `{ "name": "app", "private": true }` };
const registers = `(globalThis.registered ??= []).push("one");\n`;
const counts = `export const count = () => (globalThis.registered ?? []).length;\n`;
const main = (name: string) => `import "${name}/register";\nimport { count } from "${name}";\nconsole.log(count());\n`;
const ways = `"exports": { ".": "./dist/esm/index.mjs", "./register": "./dist/esm/register.mjs" }`;
const copied = (list: string) => `{ "name": "tool", "version": "1.0.0", "sideEffects": ["${list}"], ${ways} }`;
const built = (list: string, index = counts) => ({
  "node_modules/tool/package.json": copied(list),
  "node_modules/tool/dist/package.json": copied(list),
  "node_modules/tool/dist/esm/index.mjs": index,
  "node_modules/tool/dist/esm/register.mjs": registers,
});
const silent = (index: string) => ({
  ...built("", index),
  "node_modules/tool/package.json": `{ "name": "tool", "version": "1.0.0", ${ways} }`,
  "node_modules/tool/dist/package.json": `{ "name": "tool-dist", "sideEffects": false }`,
});

const pointedAt = (name: string, folder: string) => ({
  "main.mjs": main(name),
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "version": "1.0.0", "main": "./dist/index.mjs", "sideEffects": false }`,
  [`node_modules/${name}/dist/index.mjs`]: counts,
  [`node_modules/${name}/dist/register.mjs`]: registers,
  [`node_modules/${name}/register/package.json`]: folder,
});

const projects: Record<string, { files: Record<string, string>; says: string }> = {
  "a nearer manifest without a name lists the file": {
    files: {
      "main.mjs": main("kit"),
      "node_modules/kit/package.json": `{ "name": "kit", "version": "1.0.0", "sideEffects": false, "exports": { ".": "./esm/index.mjs", "./register": "./esm/register.mjs" } }`,
      "node_modules/kit/esm/package.json": `{ "type": "module", "sideEffects": ["./register.mjs"] }`,
      "node_modules/kit/esm/index.mjs": counts,
      "node_modules/kit/esm/register.mjs": registers,
    },
    says: "1\n",
  },
  "a folder with a manifest of its own lists its index": {
    files: {
      "main.mjs": `import "dates/locale";\nimport { count } from "dates";\nconsole.log(count());\n`,
      "node_modules/dates/package.json": `{ "name": "dates", "version": "1.0.0", "main": "./index.mjs", "sideEffects": false }`,
      "node_modules/dates/index.mjs": counts,
      "node_modules/dates/locale/package.json": `{ "main": "./index.mjs", "sideEffects": ["./index.mjs"] }`,
      "node_modules/dates/locale/index.mjs": registers,
    },
    says: "1\n",
  },
  "the manifest is copied beside the built files, where its list names nothing": {
    files: { "main.mjs": main("tool"), ...built("./dist/esm/register.mjs") },
    says: "1\n",
  },
  "the list of that manifest is a pattern": {
    files: { "main.mjs": main("tool"), ...built("./dist/esm/regis*.mjs") },
    says: "1\n",
  },
  "the listed file is imported from inside the package alone": {
    files: {
      "main.mjs": `import { count } from "tool";\nconsole.log(count());\n`,
      ...built("./dist/esm/register.mjs", `import "./register.mjs";\n` + counts),
    },
    says: "1\n",
  },
  "a nearer manifest without a name says false where the package says nothing": {
    files: {
      "main.mjs": `import { a } from "twofold";\nconsole.log(a, globalThis.ranB ?? false);\n`,
      "node_modules/twofold/package.json": `{ "name": "twofold", "version": "1.0.0", "exports": { ".": "./esm/index.mjs" } }`,
      "node_modules/twofold/esm/package.json": `{ "type": "module", "sideEffects": false }`,
      "node_modules/twofold/esm/index.mjs": `export { a } from "./a.mjs";\nexport { b } from "./b.mjs";\n`,
      "node_modules/twofold/esm/a.mjs": `export const a = 1;\n`,
      "node_modules/twofold/esm/b.mjs": `globalThis.ranB = true;\nexport const b = 2;\n`,
    },
    says: "1 true\n",
  },
  "a nearer manifest with a name says false where the package says nothing": {
    files: { "main.mjs": main("tool"), ...silent(counts) },
    says: "1\n",
  },
  "the file of such a package is imported from inside it alone": {
    files: {
      "main.mjs": `import { count } from "tool";\nconsole.log(count());\n`,
      ...silent(`import "./register.mjs";\n` + counts),
    },
    says: "1\n",
  },
  "the list names main and an import takes module": {
    files: {
      "main.mjs": `import "both";\nconsole.log((globalThis.registered ?? []).length);\n`,
      "node_modules/both/package.json": `{ "name": "both", "version": "1.0.0", "main": "./main.cjs", "module": "./esm.mjs", "sideEffects": ["./main.cjs"] }`,
      "node_modules/both/main.cjs": registers,
      "node_modules/both/esm.mjs": registers + "export {};\n",
    },
    says: "1\n",
  },
  "a folder with a name points at a file elsewhere in the package and says nothing": {
    files: pointedAt("crate", `{ "name": "crate-register", "version": "1.0.0", "main": "../dist/register.mjs" }`),
    says: "1\n",
  },
  "a folder without a name points at a file elsewhere in the package and lists it": {
    files: pointedAt("crate", `{ "main": "../dist/register.mjs", "sideEffects": ["../dist/register.mjs"] }`),
    says: "1\n",
  },
  "such a folder in a package in a scope, and the file's own path is imported first": {
    files: {
      ...pointedAt("@yard/crate", `{ "name": "crate-register", "version": "1.0.0", "main": "../dist/register.mjs" }`),
      "main.mjs": `import "@yard/crate/dist/register.mjs";\n` + main("@yard/crate"),
    },
    says: "1\n",
  },
};

test.concurrent.each(Object.keys(projects))(
  "%s",
  async name => {
    using dir = tempDir("aot-manifest-that-lists-a-file", { ...app, ...projects[name].files });
    const cwd = String(dir);
    const plain = await run([bunExe(), "./main.mjs"], cwd, bunEnv);
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: projects[name].says, exitCode: 0 });
    const executable = join(cwd, isWindows ? "compiled.exe" : "compiled");
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
      cwd,
      bunEnv,
    );
    expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const compiled = await run([executable], cwd, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: projects[name].says,
      exitCode: 0,
    });
  },
  240_000,
);
