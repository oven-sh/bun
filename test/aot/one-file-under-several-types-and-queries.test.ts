// An executable holds a file under each type that the program imports it as, and under each query. What a load is answered with is
// what the program prints under `bun run`: the file under a query is no form of the file itself, and a type of code behind a type of
// data is answered by the data. `--compile` without `aot` refuses to build most of these programs, so each says what it prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const says = `const says = async (label, load) => console.log(label, await load().then(found => JSON.stringify(found.default), error => error.name));\n`;
const files = {
  "part.mjs": `export const k = "m";\nexport default "mjs";\n`,
  "notes.md": "# title\ntext\n",
  "given.zz": "on the disk",
  "tsconfig.json": `{ "compilerOptions": { "module": "preserve", "moduleResolution": "bundler", "allowJs": true, "noEmit": true, "types": [] }, "files": [] }`,
  "build.mjs": `const [outfile, withPlugin] = process.argv.slice(2);
import { dirname, join } from "node:path";
const plugin = {
  name: "texts",
  setup(build) {
    build.onResolve({ filter: /\\?(text|raw)$/ }, args => ({ path: join(args.resolveDir || dirname(args.importer), args.path), namespace: "file" }));
    build.onLoad({ filter: /\\?(text|raw)$/ }, () => ({ contents: "made by the plugin", loader: "text" }));
    build.onLoad({ filter: /\\.zz$/ }, () => ({ contents: "export const k = 'p'; export default 'made';", loader: "ts" }));
  },
};
const built = await Bun.build({ entrypoints: ["./main.mjs"], plugins: withPlugin === "plugin" ? [plugin] : [], throw: false, compile: { outfile, aot: true } });
for (const log of built.logs) console.error(String(log.message));
process.exitCode = built.success ? 0 : 1;
`,
};
const text = `"# title\\ntext\\n"`;

const cases: Record<string, { main: string; prints: string; plugin?: true }> = {
  "code as css under a query, beside an import() of the file as toml": {
    main: `import sheet from "./part.mjs?text" with { type: "css" };
${says}await says("toml", () => import("./part.mjs", { with: { type: "toml" } }));
console.log(JSON.stringify(sheet));`,
    prints: "toml BuildMessage\n{}\n",
  },
  "code as text under a query, beside an import() of the file as toml": {
    main: `import words from "./part.mjs?text" with { type: "text" };
${says}await says("toml", () => import("./part.mjs", { with: { type: "toml" } }));
console.log(words.length);`,
    prints: "toml BuildMessage\n44\n",
  },
  "a file under a query that nothing reads, beside an import() of the file as toml": {
    main: `import "./part.mjs?text" with { type: "css" };
${says}await says("toml", () => import("./part.mjs", { with: { type: "toml" } }));`,
    prints: "toml BuildMessage\n",
  },
  "data as text, and as code afterwards": {
    main: `${says}await says("text", () => import("./notes.md", { with: { type: "text" } }));
await says("ts", () => import("./notes.md", { with: { type: "ts" } }));
await says("tsx", () => import("./notes.md", { with: { type: "tsx" } }));`,
    prints: `text ${text}\nts ${text}\ntsx ${text}\n`,
  },
  "data as text, and as code in a call that never runs": {
    main: `${says}await says("text", () => import("./notes.md", { with: { type: "text" } }));
if (globalThis.nothing) await import("./notes.md", { with: { type: "ts" } });`,
    prints: `text ${text}\n`,
  },
  "a text of a plugin under a query, beside an import() of the file of code as toml": {
    plugin: true,
    main: `import made from "./part.mjs?text";
${says}await says("toml", () => import("./part.mjs", { with: { type: "toml" } }));
console.log(made);`,
    prints: "toml BuildMessage\nmade by the plugin\n",
  },
  "a text of a plugin under a query, beside an import() of the file of data as toml": {
    plugin: true,
    main: `import made from "./notes.md?text";
${says}await says("toml", () => import("./notes.md", { with: { type: "toml" } }));
console.log(made);`,
    prints: "toml BuildMessage\nmade by the plugin\n",
  },
  "a text of a plugin under a query, beside import() calls of another file as text and as code": {
    plugin: true,
    main: `import made from "./part.mjs?raw";
${says}await says("text", () => import("./notes.md", { with: { type: "text" } }));
await says("ts", () => import("./notes.md", { with: { type: "ts" } }));
const name = ["./part.mjs", String(globalThis.nothing ?? "raw")].join("?");
console.log(made, (await import(name)).default === made);`,
    prints: `text ${text}\nts ${text}\nmade by the plugin true\n`,
  },
  "code that a plugin gives, under a type of text in a statement and under another type in a call": {
    plugin: true,
    main: `import words from "./given.zz" with { type: "text" };
${says}await says("jsonc", () => import("./given.zz", { with: { type: "jsonc" } }));
await says("none", () => import("./given.zz"));
console.log(words);`,
    prints: `jsonc "made"\nnone "made"\nmade\n`,
  },
  "code that a plugin gives, under css in a statement and under text in a call": {
    plugin: true,
    main: `import sheet from "./given.zz" with { type: "css" };
${says}await says("text", () => import("./given.zz", { with: { type: "text" } }));
console.log(sheet);`,
    prints: `text "made"\nmade\n`,
  },
  "code that a plugin gives, under two types of data in calls": {
    plugin: true,
    main: `${says}await says("toml", () => import("./given.zz", { with: { type: "toml" } }));
await says("json5", () => import("./given.zz", { with: { type: "json5" } }));`,
    prints: `toml "made"\njson5 "made"\n`,
  },
};

describe.concurrent("compile/aot/one file under several types and queries", () => {
  for (const [name, { main, prints, plugin }] of Object.entries(cases))
    test(name, async () => {
      await slot(async () => {
        using dir = tempDir("aot-types-and-queries", { ...files, "main.mjs": main });
        const folder = String(dir);
        const executable = join(folder, isWindows ? "program.exe" : "program");
        const build = await spawned([bunExe(), "build.mjs", executable, plugin ? "plugin" : "none"], folder, bunEnv);
        expect(build).toMatchObject({ stdout: "", exitCode: 0 });
        const ran = await spawned([executable], folder, bunEnv);
        expect(ran).toMatchObject({ stdout: prints, exitCode: 0 });
      });
    });
});
