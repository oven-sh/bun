import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
    skipLibCheck: true,
  },
});

const sourcesOf = (version: string) => ({
  "tsconfig.json": tsconfig,
  "package.json": JSON.stringify({ name: "shapes", version }),
  "src/index.ts": `import { area } from "./area";
export interface Shape {
  kind: "circle" | "square";
  size: number;
}
export function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += area(shape);
  return sum;
}
`,
  "src/area.ts": `import type { Shape } from "./index";
export function area(shape: Shape): number {
  return shape.kind === "circle" ? 3 * shape.size ** 2 : shape.size ** 2;
}
`,
  "src/version.ts": `export const version: string = "${version}";\n`,
});

const under = (folder: string, files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [`${folder}/${path}`, text]));

const application = {
  "tsconfig.json": tsconfig,
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "app.ts": `import { total } from "shapes";
import { version } from "shapes/version";
console.log(total([{ kind: "square", size: 2 }, { kind: "circle", size: 1 }]), version);
`,
};

const project = { ...under("library", sourcesOf("1.2.3")), ...under("app", application) };

const environment = (root: string) => ({
  ...bunEnv,
  NO_COLOR: "1",
  BUN_INSTALL_CACHE_DIR: join(root, "cache"),
  BUN_INSTALL: join(root, "bun-install"),
});

async function bun(root: string, folder: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await spawned([bunExe(), ...args], join(root, folder), environment(root));
  expect({ args, stderr: stderr.split("\n").filter(line => /^error/.test(line)), exitCode }).toEqual({
    args,
    stderr: [],
    exitCode: 0,
  });
  return stdout;
}

const build = (root: string, folder = "library") =>
  bun(root, folder, "compile", "--library", "src/index.ts", "src/version.ts");

async function pack(root: string, folder = "library") {
  await build(root, folder);
  return (await bun(root, `${folder}/dist`, "pm", "pack", "--quiet", "--destination", root)).trim();
}

/**
 * Compiles and runs the program. `aotFiles`: how many files under an "aot" condition were compiled with their types.
 * `functionsFrom`: the .aot.ts files that the functions of the executable were written in.
 */
async function compile(root: string, folder = "app", entry = "app.ts") {
  const app = join(root, folder);
  const reportPath = join(app, "report.json");
  const flags = ["--aot-report=" + reportPath, "--aot-report-detail=functions"];
  const built = await spawned([bunExe(), "compile", `./${entry}`, ...flags], app, environment(root));
  const fromRoot = (text: string) => text.replaceAll("\\", "/").replaceAll(root.replaceAll("\\", "/"), "<root>");
  const said = (built.stdout + built.stderr)
    .split(/\r?\n/)
    .filter(line => /^(warn|error): /.test(line))
    .map(fromRoot);
  const name = entry.replace(/\.[a-z]+$/, isWindows ? ".exe" : "");
  const ran = built.exitCode === 0 ? await spawned([join(app, name)], app, environment(root)) : undefined;
  const plain = await spawned([bunExe(), entry], app, environment(root));
  const report = built.exitCode === 0 ? readBuildReport(reportPath) : undefined;
  const written = report?.functions?.map(({ file }) => file).filter(file => /\.aot\.[cm]?ts$/.test(file));
  return {
    said,
    aotFiles: report?.statistics.TypedVersionsUsed,
    functionsFrom: written && [...new Set(written.map(file => fromRoot(join(app, file))))].sort(),
    exitCode: built.exitCode,
    signal: built.signal,
    stdout: ran?.stdout,
    plain: plain.stdout,
  };
}

/** `count` files of packages with the condition, and functions from index.aot.ts in each of the folders. */
const typed = (count: number, ...folders: string[]) => ({
  aotFiles: count,
  functionsFrom: folders.map(folder => `<root>/${folder}/index.aot.ts`).sort(),
});
// index.aot.ts and version.aot.ts; the second holds no function.
const shapes = (folder = "app/node_modules/shapes") => typed(2, folder);
const compiled = (files: ReturnType<typeof typed>, stdout = "7 1.2.3\n", said: string[] = []) => ({
  said,
  ...files,
  exitCode: 0,
  signal: null,
  stdout,
  plain: stdout,
});
const stopped = (said: string[], plain = "7 1.2.3\n") => ({
  said,
  aotFiles: undefined,
  functionsFrom: undefined,
  exitCode: 1,
  signal: null,
  stdout: undefined,
  plain,
});

const scene = (
  name: string,
  body: (root: string) => Promise<void>,
  files: Record<string, string> = project,
  folder = tempDir,
) =>
  test(
    name,
    () =>
      slot(async () => {
        using dir = folder("aot-library-from-npm", files);
        await body(String(dir));
      }),
    600_000,
  );

describe.concurrent(
  "bun compile, with no flag and no setup, compiles the .aot.ts files of a package from bun compile --library",
  () => {
    scene("that bun add installed from its tarball", async root => {
      await bun(root, "app", "add", await pack(root));
      expect(await compile(root)).toEqual(compiled(shapes()));
    });

    scene("that the isolated linker installed", async root => {
      await bun(root, "app", "add", "--linker", "isolated", await pack(root));
      expect(await compile(root)).toEqual({
        ...compiled(shapes()),
        functionsFrom: [
          expect.stringMatching(
            /^<root>\/app\/node_modules\/\.bun\/shapes@[^/]+\/node_modules\/shapes\/index\.aot\.ts$/,
          ),
        ],
      });
    });

    scene("that bun add installed from its folder", async root => {
      await build(root);
      await bun(root, "app", "add", "../library/dist");
      expect(await compile(root)).toEqual(compiled(shapes()));
    });

    scene("that --minify-syntax and --minify-whitespace made smaller", async root => {
      const flags = ["--minify-syntax", "--minify-whitespace"];
      await bun(root, "library", "compile", "--library", "src/index.ts", "src/version.ts", ...flags);
      await bun(root, "app", "add", "../library/dist");
      expect(await compile(root)).toEqual(compiled(shapes()));
    });

    scene("that bun link links", async root => {
      await build(root);
      await bun(root, "library/dist", "link");
      await bun(root, "app", "link", "shapes");
      expect(await compile(root)).toEqual(compiled(shapes("library/dist")));
    });

    scene(
      "that is a workspace whose own package.json points into dist",
      async root => {
        await build(root, "packages/shapes");
        await bun(root, ".", "install");
        expect(await compile(root, "packages/app")).toEqual(compiled(shapes("packages/shapes/dist")));
      },
      {
        "package.json": JSON.stringify({ name: "workspaces", private: true, workspaces: ["packages/*"] }),
        ...under("packages/shapes", {
          ...sourcesOf("1.2.3"),
          "package.json": JSON.stringify({
            name: "shapes",
            version: "1.2.3",
            type: "module",
            exports: {
              ".": { aot: "./dist/index.aot.ts", types: "./dist/index.d.ts", default: "./dist/index.js" },
              "./version": { aot: "./dist/version.aot.ts", types: "./dist/version.d.ts", default: "./dist/version.js" },
            },
          }),
        }),
        ...under("packages/app", {
          ...application,
          "package.json": JSON.stringify({ name: "app", type: "module", dependencies: { shapes: "workspace:*" } }),
        }),
      },
    );

    scene(
      "whose entry points share a chunk",
      async root => {
        await bun(root, "library", "compile", "--library", "src/index.ts", "src/make.ts", "--splitting");
        const chunks = readdirSync(join(root, "library/dist"))
          .filter(name => /^index-\w+\./.test(name))
          .sort();
        expect(chunks.map(name => name.replace(/-\w+/, ""))).toEqual(["index.aot.ts", "index.js"]);
        await bun(root, "app", "add", "--backend=copyfile", "../library/dist");
        const files = {
          aotFiles: 3,
          functionsFrom: ["index.aot.ts", chunks[0], "make.aot.ts"]
            .map(name => `<root>/app/node_modules/shapes/${name}`)
            .sort(),
        };
        expect(await compile(root)).toEqual(compiled(files, "18\n"));
        // The .aot.ts files import the chunk's .aot.ts file, not its JavaScript.
        writeFileSync(join(root, "app/node_modules/shapes", chunks[1]), "");
        expect(await compile(root)).toMatchObject({ ...files, said: [], stdout: "18\n" });
      },
      {
        ...project,
        "library/src/area.ts":
          project["library/src/area.ts"].replace('"./index"', '"./shape"') + "export const made: Shape[] = [];\n",
        "library/src/shape.ts": `export interface Shape {\n  kind: "circle" | "square";\n  size: number;\n}\n`,
        "library/src/index.ts": `import { area, made } from "./area";
import type { Shape } from "./shape";
export function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += area(shape);
  return sum + made.length;
}
`,
        "library/src/make.ts": `import { made } from "./area";
import type { Shape } from "./shape";
export function make(size: number): Shape {
  const shape: Shape = { kind: "square", size };
  made.push(shape);
  return shape;
}
`,
        "app/app.ts": `import { total } from "shapes";
import { make } from "shapes/make";
console.log(total([make(2), { kind: "circle", size: 1 }, make(3)]));
`,
      },
    );

    scene(
      "in two versions, each from its own files",
      async root => {
        await bun(root, "app", "add", await pack(root));
        await build(root, "newer");
        cpSync(join(root, "newer/dist"), join(root, "app/node_modules/other/node_modules/shapes"), { recursive: true });
        expect(await compile(root)).toEqual(
          // Of the newer version, version.aot.ts alone.
          compiled(typed(3, "app/node_modules/shapes"), "7 1.2.3\n1.2.4\n"),
        );
      },
      {
        ...project,
        ...under("newer", sourcesOf("1.2.4")),
        "app/app.ts": application["app.ts"] + `import { theirs } from "other";\nconsole.log(theirs);\n`,
        "app/node_modules/other/package.json": JSON.stringify({
          name: "other",
          version: "1.0.0",
          type: "module",
          main: "index.js",
          types: "index.d.ts",
        }),
        "app/node_modules/other/index.js": `export { version as theirs } from "shapes/version";\n`,
        "app/node_modules/other/index.d.ts": `export declare const theirs: string;\n`,
      },
    );
  },
);

describe.concurrent(
  "bun compile, with no flag and no setup, compiles the .aot.ts files that bun build --dts wrote",
  () => {
    const withCondition = (stem: string) => ({
      types: `./${stem}.d.ts`,
      aot: `./${stem}.aot.ts`,
      default: `./${stem}.js`,
    });
    const withoutCondition = (stem: string) => ({ types: `./${stem}.d.ts`, default: `./${stem}.js` });
    const entryPoints = ["src/index.ts", "src/version.ts"];

    scene(
      "where the package.json that was written by hand has the condition",
      async root => {
        await bun(root, "library", "build", ...entryPoints, "--outdir", "dist", "--dts");
        await bun(
          root,
          "app",
          "add",
          (await bun(root, "library", "pm", "pack", "--quiet", "--destination", root)).trim(),
        );
        expect(await compile(root)).toEqual(compiled(shapes("app/node_modules/shapes/dist")));
      },
      {
        ...project,
        "library/package.json": JSON.stringify({
          name: "shapes",
          version: "1.2.3",
          type: "module",
          exports: { ".": withCondition("dist/index"), "./version": withCondition("dist/version") },
          files: ["dist"],
        }),
      },
    );

    scene(
      "for import, in a package that also has CommonJS",
      async root => {
        await bun(root, "library", "build", ...entryPoints, "--outdir", "dist/esm", "--dts");
        await bun(root, "library", "build", ...entryPoints, "--outdir", "dist/cjs", "--dts", "--format=cjs");
        writeFileSync(join(root, "library/dist/cjs/package.json"), JSON.stringify({ type: "commonjs" }));
        await bun(
          root,
          "app",
          "add",
          (await bun(root, "library", "pm", "pack", "--quiet", "--destination", root)).trim(),
        );
        expect(await compile(root)).toEqual(compiled(shapes("app/node_modules/shapes/dist/esm")));
        expect(await compile(root, "app", "app.cjs")).toEqual(compiled(typed(0)));
      },
      {
        ...project,
        "app/app.cjs": `const { total } = require("shapes");
const { version } = require("shapes/version");
console.log(total([{ kind: "square", size: 2 }, { kind: "circle", size: 1 }]), version);
`,
        "library/package.json": JSON.stringify({
          name: "shapes",
          version: "1.2.3",
          type: "module",
          exports: {
            ".": { import: withCondition("dist/esm/index"), require: withoutCondition("dist/cjs/index") },
            "./version": { import: withCondition("dist/esm/version"), require: withoutCondition("dist/cjs/version") },
          },
          files: ["dist"],
        }),
      },
    );
  },
);

describe.concurrent("an .aot.ts file of an installed package", () => {
  const installed = async (root: string) => {
    await bun(root, "app", "add", "--backend=copyfile", await pack(root));
    return join(root, "app/node_modules/shapes");
  };
  const edit = (path: string, from: string, to: string) => {
    const text = readFileSync(path, "utf8");
    expect(text).toContain(from);
    writeFileSync(path, text.replace(from, to));
  };
  const unresolved = `error: TS100151: Could not resolve: "shapes". Maybe you need to "bun install"?`;

  scene("that has a type error is compiled without its types, with a warning", async root => {
    edit(join(await installed(root), "version.aot.ts"), "version: string", "version: number");
    expect(await compile(root)).toEqual(
      compiled({ ...shapes(), aotFiles: 1 }, undefined, [
        `warn: TS100009: 'shapes' has 1 type error (the first at <root>/app/node_modules/shapes/version.aot.ts:2:7), so 1 of its 2 files are compiled without their types. They still work, but run slower.`,
      ]),
    );
  });

  scene("that does not parse stops the build", async root => {
    writeFileSync(join(await installed(root), "index.aot.ts"), "export const = ;\n");
    expect(await compile(root)).toEqual(stopped(["error: TS1134: Variable declaration expected."]));
  });

  scene("that is missing stops the build", async root => {
    rmSync(join(await installed(root), "index.aot.ts"));
    expect(await compile(root)).toEqual(stopped([unresolved]));
  });

  scene("that is missing for every entry point stops the build with an error for each", async root => {
    const folder = await installed(root);
    rmSync(join(folder, "index.aot.ts"));
    rmSync(join(folder, "version.aot.ts"));
    expect(await compile(root)).toEqual(stopped([unresolved, `error: TS100150: Could not resolve: "shapes/version"`]));
  });
});

describe.concurrent(
  "the tsconfig.json of the application does not count against the .aot.ts files of a package",
  () => {
    const withOptions = (compilerOptions: object) =>
      JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, ...compilerOptions } });
    const applicationWith = (compilerOptions: object, program: string) => ({
      "app/package.json": application["package.json"],
      "app/tsconfig.json": withOptions(compilerOptions),
      "app/app.ts": program,
    });
    const libraryOf = (name: string, source: string, compilerOptions: object = {}) => ({
      "library/tsconfig.json": withOptions(compilerOptions),
      "library/package.json": JSON.stringify({ name, version: "1.0.0" }),
      "library/src/index.ts": source,
    });
    const install = async (root: string) => {
      await bun(root, "library", "compile", "--library");
      const tarball = await bun(root, "library/dist", "pm", "pack", "--quiet", "--destination", root);
      await bun(root, "app", "add", tarball.trim());
    };
    const only = (name: string) => typed(1, `app/node_modules/${name}`);

    scene(
      "nodenext, and every flag beyond strict",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("options"), "a b c\n"));
      },
      {
        ...libraryOf(
          "options",
          `export interface Options {
  name?: string;
}
export function make(name: string | undefined): Options {
  return { name };
}
export function first(names: string[]): string {
  return names[0];
}
export function read(options: { [key: string]: string }): string {
  return options.name;
}
`,
        ),
        ...applicationWith(
          {
            module: "nodenext",
            moduleResolution: "nodenext",
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            noPropertyAccessFromIndexSignature: true,
            noImplicitOverride: true,
            noImplicitReturns: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            verbatimModuleSyntax: true,
            isolatedModules: true,
            erasableSyntaxOnly: true,
          },
          `import { first, make, read } from "options";\nconsole.log(make("a").name, first(["b"]), read({ name: "c" }));\n`,
        ),
      },
    );

    scene(
      "exactOptionalPropertyTypes, where the package has a conditional type over Partial",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("forms"), "b\n"));
      },
      {
        ...libraryOf(
          "forms",
          `type Options = { all: boolean; dot: boolean };
type Component<T> =
  | string
  | (T extends { all: false } ? never : T extends { all: true } | { all: boolean } ? string[] : never);
type Nested<T> = { [key: string]: Component<T> | Nested<T> };
type Value<T> =
  | Component<T>
  | (T extends { dot: false } ? never : T extends { dot: true } | { dot: boolean } ? Nested<T> : never);
export function store(form: Record<string, string>, key: string, value: Value<Partial<Options>>): void {
  form[key] = value;
}
`,
        ),
        ...applicationWith(
          { exactOptionalPropertyTypes: true },
          `import { store } from "forms";\nconst form: Record<string, string> = {};\nstore(form, "a", "b");\nconsole.log(form["a"]);\n`,
        ),
      },
    );

    scene(
      "a lib without what the package uses",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("answers"), "201 /mine 3 6\n"));
      },
      {
        ...libraryOf(
          "answers",
          `export interface Answer {
  body: Response;
  url: URL;
  bytes: Uint8Array;
}
export function read(answer: Answer): string {
  return answer.body.status + " " + answer.url.pathname + " " + answer.bytes.length;
}
export function last(list: Answer[]): number {
  return list.at(-1)!.bytes.length * 2;
}
`,
        ),
        ...applicationWith(
          { target: "es2015", lib: ["es2015"] },
          `import { last, read, type Answer } from "answers";
declare const Response: new (body: string, options: { status: number }) => Answer["body"];
declare const URL: new (url: string) => Answer["url"];
declare const console: { log(...values: unknown[]): void };
const answer: Answer = { body: new Response("x", { status: 201 }), url: new URL("http://a/mine"), bytes: new Uint8Array(3) };
console.log(read(answer), last([answer]));
`,
        ),
      },
    );

    scene(
      "the globals of @types/bun, where the package has those of the DOM",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("boxes"), "200 /one 3 201 /mine 3 16 31 201 a\n"));
      },
      {
        ...libraryOf(
          "boxes",
          `export interface Box {
  body: Response | null;
  url: URL;
  bytes: Uint8Array;
}
export function make(text: string): Box {
  return { body: new Response(text), url: new URL("http://a/" + text), bytes: new TextEncoder().encode(text) };
}
export function read(box: Box): string {
  return (box.body ? box.body.status : 0) + " " + box.url.pathname + " " + box.bytes.length;
}
export function keep(list: Box[], box: Box): number {
  list.push(box);
  let n = 0;
  for (const kept of list) n += kept.bytes.length + kept.url.href.length;
  return n;
}
`,
        ),
        ...applicationWith(
          { lib: ["esnext"], types: ["bun"] },
          `import { keep, make, read, type Box } from "boxes";
const list: Box[] = [];
const mine: Box = { body: new Response("x", { status: 201 }), url: new URL("http://b/mine"), bytes: Buffer.from("abc") };
console.log(read(make("one")), read(mine), keep(list, mine), keep(list, make("two")), list[0]!.body!.status, list[1]!.url.host);
`,
        ),
      },
      tempDirWithBunTypes,
    );

    scene(
      "no null checks, where the program stores null and undefined in the package's fields",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("chains"), "3 1 threw 2 undefined 3\n"));
      },
      {
        ...libraryOf(
          "chains",
          `export interface Item {
  name: string;
  next: Item | null;
  count?: number;
}
export function chain(names: string[]): Item | null {
  let head: Item | null = null;
  for (const name of names) head = { name, next: head };
  return head;
}
export function length(item: Item | null): number {
  let n = 0;
  while (item) {
    n += item.name.length + (item.count ?? 0);
    item = item.next;
  }
  return n;
}
export function first(list: Item[]): Item {
  return list[0]!;
}
`,
        ),
        ...applicationWith(
          { strict: false },
          `import { chain, first, length, type Item } from "chains";
const a: Item = { name: "a", next: null, count: undefined };
const b: Item = { name: "b", next: undefined, count: 2 };
const c: Item = { name: null, next: a };
let threw = "no";
try {
  length(c);
} catch {
  threw = "threw";
}
console.log(length(chain(["x", "yy"])), length(a), threw, first([b]).count, first([]), length(b));
`,
        ),
      },
    );

    scene(
      "an interface of the package that the program adds a member to",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("totals"), "7 3 undefined\n"));
      },
      {
        ...libraryOf(
          "totals",
          `export interface Options {
  name: string;
  times: number;
}
export function total(list: Options[]): number {
  let n = 0;
  for (const options of list) n += options.times + options.name.length;
  return n;
}
export function make(name: string, times: number): Options {
  return { name, times };
}
`,
        ),
        ...applicationWith(
          {},
          `import { make, total, type Options } from "totals";
declare module "totals" {
  interface Options {
    extra?: { deep: number };
  }
}
const list: Options[] = [make("a", 1), { name: "b", times: 4, extra: { deep: 3 } }];
console.log(total(list), list[1]!.extra!.deep, list[0]!.extra);
`,
        ),
      },
    );

    scene(
      "exactOptionalPropertyTypes in the package alone, where the program stores undefined in an optional field",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("counts"), "5 2 true false undefined NaN\n"));
      },
      {
        ...libraryOf(
          "counts",
          `export interface Item {
  name: string;
  count?: number;
}
export function total(list: Item[]): number {
  let n = 0;
  for (const item of list) n += "count" in item ? item.count! + 1 : item.name.length;
  return n;
}
export function has(item: Item): boolean {
  return "count" in item;
}
`,
          { exactOptionalPropertyTypes: true },
        ),
        ...applicationWith(
          {},
          `import { has, total, type Item } from "counts";
const empty: Item = { name: "ab", count: undefined };
const list: Item[] = [{ name: "abc", count: 1 }, { name: "abc" }];
console.log(total(list), list.length, has(empty), has(list[1]!), empty.count, total([empty]));
`,
        ),
      },
    );

    const entries = `export interface Entry {
  name: string;
  size: number;
}
`;

    scene(
      "noUncheckedIndexedAccess in the package alone",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("lists"), "2 first undefined 4 a none 1\n"));
      },
      {
        ...libraryOf(
          "lists",
          `${entries}export function pick(list: Entry[], at: number): Entry | undefined {
  return list[at];
}
export function sizes(list: Entry[]): number {
  let n = 0;
  for (let i = 0; i <= list.length; i++) n += list[i]?.size ?? -1;
  return n;
}
export function named(table: { [key: string]: Entry }, key: string): string {
  const entry = table[key];
  return entry ? entry.name : "none";
}
export const table: { [key: string]: Entry } = { a: { name: "a", size: 1 } };
export const list: Entry[] = [{ name: "first", size: 2 }];
`,
          { noUncheckedIndexedAccess: true },
        ),
        ...applicationWith(
          {},
          `import { list, named, pick, sizes, table, type Entry } from "lists";
const missing: Entry = list[5];
const absent: Entry = table["nope"];
let threw = 0;
try {
  console.log(missing.name);
} catch {
  threw++;
}
try {
  console.log(absent.size);
} catch {
  threw++;
}
const holes: Entry[] = [];
holes[2] = { name: "late", size: 7 };
console.log(threw, pick(list, 0)!.name, pick(list, 9), sizes(holes), named(table, "a"), named(table, "b"), sizes(list));
`,
        ),
      },
    );

    scene(
      "noUncheckedIndexedAccess in the program alone, where the package returns what is not in the list",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(
          compiled(only("lists"), "3 undefined undefined 1 undefined undefined 0 b\n"),
        );
      },
      {
        ...libraryOf(
          "lists",
          `${entries}export function first(list: Entry[]): Entry {
  return list[0];
}
export function at(table: { [key: string]: Entry }, key: string): Entry {
  return table[key];
}
export function nameOf(list: Entry[], index: number): string {
  return list[index].name;
}
export function keep(list: Entry[], index: number): Entry[] {
  const kept: Entry[] = [list[index]];
  return kept;
}
export function total(list: Entry[]): number {
  let n = 0;
  for (const entry of list) n += entry ? entry.size : 0;
  return n;
}
`,
        ),
        ...applicationWith(
          { noUncheckedIndexedAccess: true },
          `import { at, first, keep, nameOf, total, type Entry } from "lists";
const none: Entry[] = [];
const got: Entry = first(none);
const other: Entry = at({}, "x");
let threw = 0;
try {
  got.name;
} catch {
  threw++;
}
try {
  console.log(other.size + 1);
} catch {
  threw++;
}
try {
  console.log(nameOf(none, 3));
} catch {
  threw++;
}
const kept = keep(none, 1);
console.log(threw, got, other, kept.length, kept[0], typeof kept[0], total(kept), nameOf([{ name: "b", size: 1 }], 0));
`,
        ),
      },
    );

    scene(
      "a const enum and an enum of the package, and a number that is no member",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(
          compiled(only("levels"), "8 low high undefined threw 2 3 true blue blue,red,red,blue High\n"),
        );
      },
      {
        ...libraryOf(
          "levels",
          `export const enum Level {
  Low = 1,
  High = 2,
}
export enum Color {
  Red = "red",
  Blue = "blue",
}
export enum Rank {
  Low,
  High,
}
export interface Entry {
  level: Level;
  color: Color;
}
export function name(level: Level): string {
  switch (level) {
    case Level.Low:
      return "low";
    case Level.High:
      return "high";
  }
}
export function make(high: boolean): Entry {
  return { level: high ? Level.High : Level.Low, color: high ? Color.Blue : Color.Red };
}
export function sum(list: Entry[]): number {
  let n = 0;
  for (const entry of list) n += entry.level;
  return n;
}
`,
        ),
        ...applicationWith(
          {},
          `import { Color, Level, Rank, make, name, sum, type Entry } from "levels";
const three: number = [1, 2, 3].length;
const odd: Entry = { level: three, color: Color.Red };
const list: Entry[] = [make(true), make(false), odd, { level: Level.High, color: Color.Blue }];
const unnamed: string = name(three);
let threw = "no";
try {
  unnamed.length;
} catch {
  threw = "threw";
}
console.log(
  sum(list),
  name(Level.Low),
  name(list[0]!.level),
  unnamed,
  threw,
  Level.High,
  Level.Low + Level.High,
  list[0]!.level === Level.High,
  Color.Blue,
  list.map(entry => entry.color).join(),
  Rank[Rank.High],
);
`,
        ),
      },
    );

    scene(
      "a conditional type over a global that only one of the two has",
      async root => {
        await install(root);
        const { said, aotFiles, ...rest } = await compile(root);
        expect(rest).toEqual(
          (({ said, aotFiles, ...rest }) => rest)(compiled(only("stamps"), "string:2:2 number:7:1 string number\n")),
        );
        // With its types or without them: both are right.
        expect(said.filter(line => !line.startsWith("warn: TS100009: 'stamps' has"))).toEqual([]);
        expect(aotFiles).toBe(1 - said.length);
      },
      {
        ...libraryOf(
          "stamps",
          `type Stamp = typeof globalThis extends { Bun: infer B } ? number : string;
export interface Row {
  stamp: Stamp;
  id: number;
}
export function row(id: number): Row {
  return { stamp: String(id) as Stamp, id };
}
export function show(row: Row): string {
  return typeof row.stamp + ":" + row.stamp + ":" + row.id;
}
`,
        ),
        ...applicationWith(
          {},
          `import { row, show, type Row } from "stamps";
declare global {
  var Bun: object;
}
const mine: Row = { stamp: 7 as any, id: 1 };
const rows: Row[] = [row(2), mine];
console.log(rows.map(show).join(" "), typeof rows[0]!.stamp, typeof rows[1]!.stamp);
`,
        ),
      },
    );

    scene(
      "a field that is a string to the package and a number to the program",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("widths"), "undefined 2 8.5 s31 9.5s4 NaN\n"));
      },
      {
        ...libraryOf(
          "widths",
          `type Stamp = typeof globalThis extends { onlyInTheProgram: infer _ } ? number : string;
export interface Row {
  stamp: Stamp;
  id: number;
}
export function row(id: number): Row {
  return { stamp: "s" + id, id };
}
export function width(row: Row): number {
  return row.stamp.length;
}
export function joined(rows: Row[]): string {
  let text = "";
  for (const row of rows) text += row.stamp;
  return text;
}
`,
        ),
        ...applicationWith(
          {},
          `import { joined, row, width, type Row } from "widths";
declare global {
  var onlyInTheProgram: number;
}
const mine: Row = { stamp: 7.5, id: 1 };
const rows: Row[] = [{ stamp: 9.5, id: 2 }, row(4)];
let product = 1;
for (const each of rows) product *= each.stamp;
console.log(width(mine), width(row(2)), mine.stamp + 1, row(3).stamp + 1, joined(rows), product);
`,
        ),
      },
    );

    scene(
      "what is a string to the package, kept where the program declares a number",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(
          compiled(only("stamps"), "NaN 0 s01,h01,s01,a1,s11,h11,s11,b1,s21,h21,s21,a1 string,string,string NaN\n"),
        );
      },
      {
        ...libraryOf(
          "stamps",
          `type Stamp = typeof globalThis extends { onlyInTheProgram: infer _ } ? number : string;
export interface Row {
  stamp: Stamp;
  id: number;
}
export class Holder {
  stamp: Stamp;
  constructor(id: number) {
    this.stamp = "h" + id;
  }
}
export function row(id: number): Row {
  return { stamp: "s" + id, id };
}
export function stampOf(row: Row): Stamp {
  return row.stamp;
}
export const stamps: Stamp[] = ["a", "b"];
`,
        ),
        ...applicationWith(
          {},
          `import { Holder, row, stampOf, stamps } from "stamps";
declare global {
  var onlyInTheProgram: number;
}
declare const process: { argv: string[] };
interface Mine {
  n: number;
  label: string;
}
const all: Mine[] = [];
const numbers: number[] = [];
const count = process.argv.length + 1;
for (let i = 0; i < count; i++) {
  all.push({ n: stampOf(row(i)), label: "x" + i });
  numbers.push(stampOf(row(i)), new Holder(i).stamp, row(i).stamp, stamps[i % 2]!);
}
let sum = 0;
for (const mine of all) sum += mine.n * 2;
let bits = 0;
for (const n of numbers) bits ^= n | 0;
console.log(sum, bits, numbers.map(n => n + 1).join(), all.map(mine => typeof mine.n).join(), Math.max(...numbers));
`,
        ),
      },
    );

    scene(
      "members that the program adds to an interface and a class, stored in objects that the package made",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(
          compiled(
            only("grown"),
            `179 m0m1m2m3m4m5m6m7mine 48 60 undefined undefined name,times,extra,more count,label,added,tail {"name":"n1","times":1,"extra":2,"more":"m1","deep":{"value":1}}\n`,
          ),
        );
      },
      {
        ...libraryOf(
          "grown",
          `export interface Options {
  name: string;
  times: number;
}
export class Counter {
  count: number = 1;
  label: string = "c";
  bump(): number {
    return ++this.count;
  }
}
export function total(list: Options[]): number {
  let n = 0;
  for (const options of list) n += options.times + options.name.length;
  return n;
}
export function make(name: string, times: number): Options {
  return { name, times };
}
export function many(count: number): Options[] {
  const list: Options[] = [];
  for (let i = 0; i < count; i++) list.push({ name: "n" + i, times: i });
  return list;
}
export function counters(count: number): Counter[] {
  const list: Counter[] = [];
  for (let i = 0; i < count; i++) list.push(new Counter());
  return list;
}
`,
        ),
        ...applicationWith(
          {},
          `import { counters, make, many, total, type Counter, type Options } from "grown";
declare module "grown" {
  interface Options {
    extra: number;
    more: string;
    deep?: { value: number };
  }
  interface Counter {
    added: number;
    tail: string;
  }
}
declare const process: { argv: string[] };
const count = process.argv.length + 6;
const list: Options[] = many(count);
for (let i = 0; i < list.length; i++) {
  const each = list[i]!;
  each.extra = i * 2;
  each.more = "m" + i;
  if (i & 1) each.deep = { value: i };
}
list.push({ name: "own", times: 1, extra: 100, more: "mine", deep: { value: 7 } });
let sum = 0;
let text = "";
for (const each of list) {
  sum += each.extra + (each.deep ? each.deep.value : 0);
  text += each.more;
}
const all: Counter[] = counters(count);
for (let i = 0; i < all.length; i++) {
  all[i]!.added = i;
  all[i]!.tail = "t" + i;
}
let added = 0;
for (const each of all) added += each.added + each.bump() + each.tail.length;
const fresh = make("z", 3);
console.log(
  sum,
  text,
  total(list),
  added,
  fresh.extra,
  fresh.more,
  Object.keys(list[0]!).join(),
  Object.keys(all[1]!).join(),
  JSON.stringify(list[1]),
);
`,
        ),
      },
    );

    scene(
      "no null checks in the program, whose callbacks return null where the package expects a number or an object",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(compiled(only("folds"), "3 0 threw 2 null\n"));
      },
      {
        ...libraryOf(
          "folds",
          `export interface Item {
  name: string;
}
export function fold(list: Item[], size: (item: Item) => number): number {
  let n = 0;
  for (const item of list) n += size(item);
  return n;
}
export function names(count: number, make: (index: number) => Item): number {
  let n = 0;
  for (let i = 0; i < count; i++) n += make(i).name.length;
  return n;
}
export function last(count: number, make: (index: number) => Item): Item {
  let item: Item = { name: "" };
  for (let i = 0; i < count; i++) item = make(i);
  return item;
}
`,
        ),
        ...applicationWith(
          { strict: false },
          `import { fold, last, names, type Item } from "folds";
const list: Item[] = [{ name: "a" }, { name: "bc" }];
const nothing = (item: Item): number => null;
const none = (index: number): Item => (index ? null : { name: "ab" });
let threw = "no";
try {
  names(2, none);
} catch {
  threw = "threw";
}
console.log(fold(list, item => item.name.length), fold(list, nothing), threw, names(1, none), last(2, none));
`,
        ),
      },
    );

    scene(
      "no null checks in the package, which returns and stores null where the program expects a string",
      async root => {
        await install(root);
        expect(await compile(root)).toEqual(
          compiled(only("finds"), "2 b null null 1\n5 2,,1,1,,,4 2:true,null:null,1:true 3,1,2,2,1,NaN,5\n"),
        );
      },
      {
        ...libraryOf(
          "finds",
          `export interface Found {
  text: string;
  next: Found;
}
export function find(list: string[], text: string): string {
  for (const each of list) if (each === text) return each;
  return null;
}
export function found(text: string): Found {
  return { text: text === "" ? null : text, next: null };
}
export function size(text: string): number {
  return text ? text.length : null;
}
export function flag(text: string): boolean {
  return text ? true : null;
}
export const sizes: number[] = [1, null, undefined, 4];
`,
          { strict: false },
        ),
        ...applicationWith(
          {},
          `import { find, flag, found, size, sizes, type Found } from "finds";
let threw = 0;
try {
  console.log(find([], "a").length);
} catch {
  threw++;
}
const empty: Found = found("");
try {
  console.log(empty.text.length + empty.next.text.length);
} catch {
  threw++;
}
console.log(threw, find(["b"], "b"), empty.text, found("c").next, found("c").text.length);
interface Mine {
  n: number;
  on: boolean;
}
const all: Mine[] = [];
const numbers: number[] = [];
for (const text of ["ab", "", "c"]) {
  all.push({ n: size(text), on: flag(text) });
  numbers.push(size(text));
}
for (const each of sizes) numbers.push(each);
let sum = 0;
for (const mine of all) sum += mine.n + (mine.on ? 1 : 0);
console.log(sum, numbers.join(), all.map(mine => mine.n + ":" + mine.on).join(), numbers.map(n => n + 1).join());
`,
        ),
      },
    );

    scene(
      "two versions whose interfaces of one name differ, one of them under another typed package",
      async root => {
        await install(root);
        await bun(root, "newer", "compile", "--library");
        cpSync(join(root, "newer/dist"), join(root, "between/node_modules/shapes"), { recursive: true });
        await bun(root, "between", "compile", "--library");
        cpSync(join(root, "between/dist"), join(root, "app/node_modules/between"), { recursive: true });
        cpSync(join(root, "newer/dist"), join(root, "app/node_modules/between/node_modules/shapes"), {
          recursive: true,
        });
        expect(await compile(root)).toEqual(
          compiled(
            typed(
              3,
              "app/node_modules/between",
              "app/node_modules/shapes",
              "app/node_modules/between/node_modules/shapes",
            ),
            "6 16 7 seven no 0sevenundefined\n",
          ),
        );
      },
      {
        ...libraryOf(
          "shapes",
          `export interface Options {
  name: string;
  times: number;
}
export function total(list: Options[]): number {
  let n = 0;
  for (const options of list) n += options.times + options.name.length;
  return n;
}
export function make(name: string, times: number): Options {
  return { name, times };
}
`,
        ),
        "newer/tsconfig.json": tsconfig,
        "newer/package.json": JSON.stringify({ name: "shapes", version: "2.0.0" }),
        "newer/src/index.ts": `export interface Options {
  times: string;
  name: number;
  more: boolean;
}
export function total(list: Options[]): number {
  let n = 0;
  for (const options of list) n += options.times.length + options.name + (options.more ? 1 : 0);
  return n;
}
export function make(name: number, times: string): Options {
  return { times, name, more: true };
}
`,
        "between/tsconfig.json": withOptions({ noUncheckedIndexedAccess: true }),
        "between/package.json": JSON.stringify({
          name: "between",
          version: "1.0.0",
          dependencies: { shapes: "2.0.0" },
        }),
        "between/src/index.ts": `import { make, total, type Options } from "shapes";
export function sum(count: number): number {
  const list: Options[] = [];
  for (let i = 0; i < count; i++) list.push(make(i, "x".repeat(i)));
  return total(list);
}
export function pass(): Options {
  return make(7, "seven");
}
`,
        ...applicationWith(
          {},
          `import { pass, sum } from "between";
import { make, total, type Options } from "shapes";
const list: Options[] = [make("a", 1), { name: "bb", times: 2 }];
const other = pass();
let threw = "no";
try {
  total([other as any as Options]);
} catch {
  threw = "threw";
}
console.log(total(list), sum(4), other.name, other.times, threw, total([other as any as Options]));
`,
        ),
      },
    );
  },
);

describe.concurrent("bun compile finds the file under the aot condition of a hand-written package.json", () => {
  const greeter = (format: string) => ({
    javascript: `function greet(options) {\n  return "${format} " + options.name;\n}\n`,
    typed: `interface Options {\n  name: string;\n}\nfunction greet(options: Options): string {\n  return "${format} " + options.name;\n}\n`,
    declarations: `export interface Options {\n  name: string;\n}\nexport declare function greet(options: Options): string;\n`,
  });
  const [esm, cjs] = [greeter("esm"), greeter("cjs")];
  const dual = {
    "tsconfig.json": tsconfig,
    "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      version: "1.0.0",
      type: "module",
      main: "./dist/index.cjs",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": {
          import: { types: "./dist/index.d.ts", aot: "./dist/index.aot.ts", default: "./dist/index.js" },
          require: { types: "./dist/index.d.cts", aot: "./dist/index.aot.cts", default: "./dist/index.cjs" },
        },
      },
    }),
    "node_modules/dual/dist/index.js": esm.javascript + "export { greet };\n",
    "node_modules/dual/dist/index.aot.ts": esm.typed + "export { greet };\n",
    "node_modules/dual/dist/index.d.ts": esm.declarations,
    "node_modules/dual/dist/index.cjs": cjs.javascript + "module.exports = { greet };\n",
    "node_modules/dual/dist/index.aot.cts": cjs.typed + "module.exports = { greet };\n",
    "node_modules/dual/dist/index.d.cts": cjs.declarations,
    "app.ts": `import { greet } from "dual";\nconsole.log(greet({ name: "Ada" }));\n`,
    "app.cjs": `const { greet } = require("dual");\nconsole.log(greet({ name: "Ada" }));\n`,
  };
  const one = (name: string) => ({ aotFiles: 1, functionsFrom: [`<root>/node_modules/dual/dist/${name}`] });

  scene(
    "under import, in a package that has ES modules and CommonJS",
    async root => expect(await compile(root, ".", "app.ts")).toEqual(compiled(one("index.aot.ts"), "esm Ada\n")),
    dual,
  );

  scene(
    "under require, in a package that has ES modules and CommonJS",
    async root => expect(await compile(root, ".", "app.cjs")).toEqual(compiled(one("index.aot.cts"), "cjs Ada\n")),
    dual,
  );

  scene(
    "under require, with compilerOptions in a package.json beside the files",
    async root => expect(await compile(root, ".", "app.cjs")).toEqual(compiled(one("index.aot.cts"), "cjs Ada\n")),
    { ...dual, "node_modules/dual/dist/package.json": tsconfig },
  );

  scene(
    "under a pattern, which needs a file for every name that is imported",
    async root => {
      const writeTyped = (name: string) =>
        writeFileSync(join(root, `node_modules/many/typed/${name}.ts`), `export const name: string = "${name}";\n`);
      mkdirSync(join(root, "node_modules/many/typed"), { recursive: true });
      for (const name of ["one", "two", "three"]) {
        writeFileSync(join(root, `node_modules/many/lib/${name}.js`), `export const name = "${name}";\n`);
        writeFileSync(join(root, `node_modules/many/lib/${name}.d.ts`), `export declare const name: string;\n`);
        if (name !== "three") writeTyped(name);
      }
      expect(await compile(root, ".", "app.ts")).toEqual(
        stopped([`error: TS100150: Could not resolve: "many/three"`], "one two three\n"),
      );
      writeTyped("three");
      expect(await compile(root, ".", "app.ts")).toEqual(compiled(typed(3), "one two three\n"));
    },
    {
      "tsconfig.json": tsconfig,
      "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
      "node_modules/many/package.json": JSON.stringify({
        name: "many",
        version: "1.0.0",
        type: "module",
        exports: { "./*": { types: "./lib/*.d.ts", aot: "./typed/*.ts", default: "./lib/*.js" } },
      }),
      "node_modules/many/lib/.keep": "",
      "app.ts": `import { name as one } from "many/one";\nimport { name as two } from "many/two";\nimport { name as three } from "many/three";\nconsole.log(one, two, three);\n`,
    },
  );
});
