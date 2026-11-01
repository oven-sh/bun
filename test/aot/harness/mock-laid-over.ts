// Projects for mock-laid-over*.test.ts: a mock laid over a module whose body has run. A project is the module's kind x the call x the factory x the realm. Inside it every
// kind of export is read by every kind of reader at six moments, and each reading is a line `KEY <moment> | <reader> | <export> = <value>`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { afterAll } from "./default-timeout";
import { run } from "./run";
import { runsWholeGrids } from "./ways";

export type Project = { files: Record<string, string>; flags: string[] };

const tried = `const tried = read => { try { const v = read(); return typeof v === "function" ? "function " + v.name : String(v); } catch (e) { return "threw " + String(e.message).slice(0, 60); } };\n`;
const record = (reads: [string, string][]) => `({ ${reads.map(([key, text]) => `"${key}": tried(() => ${text})`).join(", ")} })`;
const print = `for (const [reader, { read }] of Object.entries(readers)) { let seen; try { seen = read(); } catch (e) { seen = { read: "threw " + String(e.message).slice(0, 60) }; } for (const [what, value] of Object.entries(seen)) console.log("KEY", (globalThis.COLUMN ? globalThis.COLUMN + " | " : "") + moment, "|", reader, "|", what, "=", value); }`;
const head = `import { expect, jest, mock, test, vi } from "bun:test";\n${tried}`;
const ends: Record<string, (spec: string) => string> = {
  "mock.module": () => `mock.restore();`,
  "vi.doMock": spec => `vi.doUnmock("${spec}");`,
  "vi.mock": spec => `vi.doUnmock("${spec}");`,
  "jest.mock": spec => `jest.unmock("${spec}");`,
};
const places = (call: string) => (call === "mock.module" ? ["top", "test"] : call === "vi.doMock" ? ["test"] : ["hoisted"]);
const root = { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": "{}" };

function body(imports: string, look: string, call: string, where: string, acts: string, end: string) {
  const first =
    where === "hoisted"
      ? `${call};\n${imports}${look}test("mocked", async () => {\n  await look("1 mocked");\n`
      : where === "top"
        ? `${imports}${look}await ${call};\ntest("mocked", async () => {\n  await look("1 mocked");\n`
        : `${imports}${look}test("mocked", async () => {\n  await look("0 loaded");\n  await ${call};\n  await look("1 mocked");\n`;
  return `${head}${first}${acts}  ${end}\n  await look("3 ended");\n});\ntest("the next test", async () => {\n  await look("4 next test");\n});\n`;
}

function project(files: Record<string, string>, where: string, realm: string): Project {
  const flags = [realm === "isolate" ? "--isolate" : "--no-isolate"];
  // The body must have run when a hoisted call comes: a preload has loaded the module.
  if (where === "hoisted" || files["preload.ts"]) flags.push("--preload", "./preload.ts");
  return {
    files: { ...root, ...(where === "hoisted" && { "preload.ts": `import "./readers/before.ts";\n` }), ...files },
    // `bun test <folder>` runs the files as the file system lists them.
    flags: [...flags, "./test/a.test.ts", "./test/b.test.ts"],
  };
}

// Who lays the mock. A large program writes few mock calls and makes many: a preload or a helper lays them for every test file.
const layers = ["preload", "helper-import", "helper-call"];
const endings: Record<string, (spec: string) => string> = {
  "file-end": () => ``,
  doUnmock: spec => `vi.doUnmock("${spec}");`,
  restore: () => `mock.restore();`,
};
type Parts = { spec: string; specFromRoot: string; factory: string; imports: string; look: string; acts: string };

function laidByAnother(who: string, end: string, { spec, specFromRoot, factory, imports, look, acts }: Parts): Record<string, string> {
  const lay = (at: string) => `mock.module("${at}"${factory})`;
  const runner = `import { mock } from "bun:test";\n`;
  const mockedAlready = `test("mocked", async () => {\n  await look("1 mocked");\n`;
  const rest = `${acts}  ${endings[end](spec)}\n  await look("3 ended");\n});\ntest("the next test", async () => {\n  await look("4 next test");\n});\n`;
  // Each loads a reader first, so that the body has run when the call comes.
  if (who === "preload")
    return {
      "preload.ts": `${runner}import "./readers/before.ts";\nawait ${lay(specFromRoot)};\n`,
      "test/a.test.ts": `${head}${imports}${look}${mockedAlready}${rest}`,
    };
  if (who === "helper-import")
    return {
      "helpers/lay.ts": `${runner}import "../readers/before.ts";\nawait ${lay(spec)};\n`,
      "test/a.test.ts": `${head}import "../helpers/lay.ts";\n${imports}${look}${mockedAlready}${rest}`,
    };
  return {
    "helpers/lay.ts": `${runner}export const lay = () => ${lay(spec)};\n`,
    "test/a.test.ts": `${head}import { lay } from "../helpers/lay.ts";\n${imports}${look}test("mocked", async () => {\n  await look("0 loaded");\n  await lay();\n  await look("1 mocked");\n${rest}`,
  };
}

// An ES module: the project's own file, a package with types, a package without.
const text = (ext: string) => `import { handed as own } from "./leaf${ext}";
export function fn() { return "real fn"; }
export const arrow = () => "real arrow";
export class Klass { static tag = "real static"; who() { return "real who"; } static make() { return new Klass().who(); } }
export let counter = 0;
export function bump() { counter++; return counter; }
export const table = { n: 1 };
export function grow() { table.n++; return table.n; }
export default function main() { return "real default"; }
export * from "./star${ext}";
export * as space from "./space${ext}";
import * as again from "./space${ext}";
export { again };
${ext ? `export const Fixed = { A: "real a" };` : `export const enum Fixed { A = "real a" }`}
export { handed } from "./leaf${ext}";
export const Color = { Red: "real red" };
export const lazy = "real lazy";
export const kept = "real kept";
export const viaSibling = () => fn() + "+" + own;
`;
const beside: Record<string, string> = {
  star: `export const starred = "real starred";\n`,
  space: `export const inner = "real inner";\n`,
  leaf: `export const handed = "real handed";\n`,
};
const types = `export function fn(): string; export const arrow: () => string; export class Klass { static tag: string; who(): string; static make(): string; } export let counter: number; export function bump(): number; export const table: { n: number }; export function grow(): number; export default function main(): string; export const starred: string; export const space: { inner: string }; export const again: { inner: string }; export const Fixed: { A: string }; export const handed: string; export const Color: { Red: string }; export const lazy: string; export const kept: string; export const viaSibling: () => string;\n`;
const names = "fn, arrow, Klass, counter, table, starred, space, again, Fixed, handed, Color, lazy, kept, bump, grow, viaSibling";
const readsOf = (of: (name: string) => string, main: string): [string, string][] => [
  ["fn", `${of("fn")}()`],
  ["arrow", `${of("arrow")}()`],
  ["Klass.who", `new ${of("Klass")}().who()`],
  ["Klass.tag", `${of("Klass")}.tag`],
  ["Klass.make", `${of("Klass")}.make()`],
  ["counter", of("counter")],
  ["table.n", `${of("table")}.n`],
  ["default", `${main}()`],
  ["starred", of("starred")],
  ["space.inner", `${of("space")}.inner`],
  ["again.inner", `${of("again")}.inner`],
  ["Fixed.A", `${of("Fixed")}.A`],
  ["handed", of("handed")],
  ["Color.Red", `${of("Color")}.Red`],
  ["lazy", of("lazy")],
  ["kept", of("kept")],
  ["viaSibling", `${of("viaSibling")}()`],
];
const offNamespace = record(readsOf(name => `ns.${name}`, "ns.default"));
const keys = `keys: Object.keys(ns).sort().join("+")`;

function readersOf(spec: string): Record<string, string> {
  const byName = `${tried}import main, { ${names} } from "${spec}";\nexport const read = () => ${record(readsOf(name => name, "main"))};\nexport const act = () => [tried(() => bump()), tried(() => grow())].join();\n`;
  const namespace = `${tried}import * as ns from "${spec}";\nexport const read = () => ({ ...${offNamespace}, ${keys}, added: tried(() => ns.added) });\n`;
  return {
    "readers/before.ts": byName,
    "readers/after.ts": byName,
    "readers/namespace.ts": namespace,
    "readers/after-namespace.ts": namespace,
    "readers/captured.ts": `${tried}import main, { fn, arrow, Klass, counter, table, starred, Color, lazy } from "${spec}";\nconst held = { fn, arrow, Klass, counter, table, main, starred, Color, lazy };\nexport const read = () => ({ fn: tried(() => held.fn()), arrow: tried(() => held.arrow()), "Klass.who": tried(() => new held.Klass().who()), counter: tried(() => held.counter), "table.n": tried(() => held.table.n), default: tried(() => held.main()), starred: tried(() => held.starred), "Color.Red": tried(() => held.Color.Red), lazy: tried(() => held.lazy), "same fn": tried(() => held.fn === fn), "same Klass": tried(() => held.Klass === Klass) });\n`,
    "readers/extends.ts": `${tried}import { Klass, fn } from "${spec}";\nclass Sub extends Klass {}\nconst withDefault = (x = fn()) => x;\nconst makes = (K = Klass) => new K().who();\nexport const read = () => ({ "Sub.who": tried(() => new Sub().who()), "Sub.tag": tried(() => Sub.tag), "Sub instanceof Klass": tried(() => new Sub() instanceof Klass), "default parameter": tried(() => withDefault()), "default parameter class": tried(() => makes()) });\n`,
    "readers/barrel.ts": `export * from "${spec}";\nexport { default } from "${spec}";\n`,
  };
}

const mocked = (more: string) =>
  `{ fn: () => "mock fn", arrow: () => "mock arrow", Klass: class Klass { static tag = "mock static"; who() { return "mock who"; } static make() { return "mock make"; } }, counter: 100, table: { n: 100 }, default: () => "mock default", starred: "mock starred", space: { inner: "mock inner" }, again: { inner: "mock inner" }, Fixed: { A: "mock a" }, handed: "mock handed", Color: { Red: "mock red" }, get lazy() { return "mock lazy"; }, added: "mock added"${more} }`;
const factories: Record<string, string> = {
  factory: `, () => (${mocked("")})`,
  original: `, async importOriginal => { const ORIGINAL = await importOriginal(); return ${mocked(", bump: ORIGINAL.bump, grow: ORIGINAL.grow, viaSibling: ORIGINAL.viaSibling, kept: ORIGINAL.kept")}; }`,
  spread: `, async importOriginal => ({ ...(await importOriginal()), fn: () => "mock fn", counter: 100 })`,
  spy: `, { spy: true }`,
  none: ``,
};
const calls: Record<string, string[]> = {
  "mock.module": ["factory", "original", "spread"],
  "vi.doMock": ["factory", "original", "spread", "spy", "none"],
  "vi.mock": ["factory", "original", "spread", "spy", "none"],
  "jest.mock": ["factory", "none"],
};

function filesOfModule(kind: string): [string, Record<string, string>] {
  const others = (folder: string, ext: string) =>
    Object.fromEntries(Object.entries(beside).map(([name, source]) => [`${folder}/${name}.${ext}`, source]));
  if (kind === "project") return ["../lib/lib.ts", { "lib/lib.ts": text(""), ...others("lib", "ts") }];
  const isTyped = kind === "typed-package";
  const manifest = { name: "pkg", version: "1.0.0", type: "module", main: "./index.js", ...(isTyped && { types: "./index.d.ts" }) };
  return [
    "pkg",
    {
      "node_modules/pkg/package.json": JSON.stringify(manifest),
      "node_modules/pkg/index.js": text(".js"),
      ...others("node_modules/pkg", "js"),
      ...(isTyped && { "node_modules/pkg/index.d.ts": types }),
    },
  ];
}

export function modules(): Map<string, Project> {
  const projects = new Map<string, Project>();
  for (const kind of ["project", "typed-package", "untyped-package"]) {
    const [spec, files] = filesOfModule(kind);
    const look = `async function look(moment) {
  const readers = { before, namespace, captured, "extends": extended, barrel: { read: () => ({ fn: tried(() => barrel.fn()), default: tried(() => barrel.default()), starred: tried(() => barrel.starred), keys: Object.keys(barrel).sort().join("+") }) },
    ...(moment === "0 loaded" ? {} : { after: await import("../readers/after.ts"), "after namespace": await import("../readers/after-namespace.ts") }),
    "import()": { read: await (async () => { const ns = await import("${spec}"); return () => ({ ...${offNamespace}, ${keys} }); })().catch(e => () => ({ load: "threw " + String(e.message).slice(0, 60) })) },
    "require()": { read: () => { const ns = import.meta.require("${spec}"); return { ...${offNamespace}, ${keys} }; } } };
  ${print}
}
`;
    const imports = `import * as before from "../readers/before.ts";\nimport * as namespace from "../readers/namespace.ts";\nimport * as captured from "../readers/captured.ts";\nimport * as extended from "../readers/extends.ts";\nimport * as barrel from "../readers/barrel.ts";\n`;
    const acts = `  console.log("KEY", (globalThis.COLUMN ? globalThis.COLUMN + " | " : "") + "2 acted | before | act =", before.act());\n  await look("2 acted");\n`;
    const next = `import { test } from "bun:test";\n${tried}import * as before from "../readers/before.ts";\nimport * as namespace from "../readers/namespace.ts";\ntest("the next file", () => { const moment = "5 next file", readers = { before, namespace }; ${print} });\n`;
    for (const [call, kinds] of Object.entries(calls))
      for (const factory of kinds)
        for (const where of places(call))
          for (const realm of ["isolate", "one-realm"])
            projects.set(
              `${kind}.${call}.${factory}.${where}.${realm}`,
              project(
                {
                  ...files,
                  ...readersOf(spec),
                  "test/a.test.ts": body(imports, look, `${call}("${spec}"${factories[factory]})`, where, acts, ends[call](spec)),
                  "test/b.test.ts": next,
                },
                where,
                realm,
              ),
            );
    const parts = { spec, specFromRoot: spec.replace("../", "./"), factory: factories.factory, imports, look, acts };
    for (const who of layers)
      for (const end of Object.keys(endings))
        for (const realm of ["isolate", "one-realm"])
          projects.set(
            `${kind}.laid-by-${who}.${end}.${realm}`,
            project({ ...files, ...readersOf(spec), ...laidByAnother(who, end, parts), "test/b.test.ts": next }, who, realm),
          );
  }
  return projects;
}

// A built-in module. M stands for how a reader reaches it.
const builtins: Record<string, [string[], Record<string, string>, string[], string]> = {
  path: [
    ["node:path", "path"],
    { fn: "M.basename('/a/b.txt')", object: "M.posix.sep", constant: "M.sep", kept: "M.extname('a.txt')" },
    ["basename", "posix", "sep", "extname"],
    "basename: () => 'mock basename', posix: { sep: 'mock posix sep' }, sep: 'mock sep'",
  ],
  os: [
    ["node:os", "os"],
    { fn: "M.platform()", constant: "typeof M.EOL + M.EOL.length", object: "typeof M.constants", kept: "typeof M.cpus" },
    ["platform", "EOL", "constants", "cpus"],
    "platform: () => 'mock platform', EOL: 'mock EOL', constants: 'mock constants'",
  ],
  fs: [
    ["node:fs", "fs"],
    { fn: "M.existsSync('/definitely/not/here')", object: "typeof M.promises.readFile", class: "typeof M.Stats", kept: "typeof M.readFileSync" },
    ["existsSync", "promises", "Stats", "readFileSync"],
    "existsSync: () => 'mock existsSync', promises: { readFile: 'mock readFile' }, Stats: 'mock Stats'",
  ],
  child_process: [
    ["node:child_process", "child_process"],
    { fn: "typeof M.execSync === 'function' ? M.execSync.name : M.execSync", kept: "typeof M.spawn" },
    ["execSync", "spawn"],
    "execSync: 'mock execSync'",
  ],
  events: [
    ["node:events", "events"],
    { class: "new M.EventEmitter().constructor.name", fn: "typeof M.once", kept: "typeof M.on" },
    ["EventEmitter", "once", "on"],
    "EventEmitter: class MockEmitter {}, once: 'mock once'",
  ],
  util: [
    ["node:util", "util"],
    { fn: "M.format('%s', 'x')", object: "typeof M.types.isDate", kept: "M.inspect(1)" },
    ["format", "types", "inspect"],
    "format: () => 'mock format', types: { isDate: 'mock isDate' }",
  ],
  bun: [
    ["bun"],
    { fn: "typeof M.which === 'function' ? 'function' : M.which", constant: "typeof M.version", kept: "typeof M.file" },
    ["which", "version", "file"],
    "which: 'mock which', version: 123",
  ],
  "bun:sqlite": [
    ["bun:sqlite"],
    { class: "typeof M.Database === 'function' ? 'function' : M.Database", kept: "typeof M.constants" },
    ["Database", "constants"],
    "Database: 'mock Database'",
  ],
  "bun:jsc": [
    ["bun:jsc"],
    { fn: "typeof M.heapSize === 'function' ? 'function' : M.heapSize", kept: "typeof M.describe" },
    ["heapSize", "describe"],
    "heapSize: 'mock heapSize'",
  ],
};
const callsOfBuiltins: Record<string, string[]> = {
  "mock.module": ["factory", "with-default", "spread"],
  "vi.doMock": ["factory", "spread", "none"],
  "vi.mock": ["factory", "with-default", "spread", "spy", "none"],
  "jest.mock": ["factory", "none"],
};

export function builtinModules(): Map<string, Project> {
  const projects = new Map<string, Project>();
  for (const [spellings, reads, imported, members] of Object.values(builtins))
    for (const spec of spellings) {
      const through = (M: string) => record(Object.entries(reads).map(([key, source]) => [key, source.replaceAll("M.", M)]));
      const byName = `${tried}import { ${imported.join(", ")} } from "${spec}";\nexport const read = () => ${through("")};\n`;
      const namespace = `${tried}import * as ns from "${spec}";\nexport const read = () => ({ ...${through("ns.")}, "has default": tried(() => "default" in ns), added: tried(() => ns.added) });\n`;
      const byDefault = `${tried}import all from "${spec}";\nexport const read = () => ({ ...${through("all.")}, added: tried(() => all.added) });\n`;
      const required = `${tried}const all = require("${spec}");\nexport const read = () => ({ ...${through("all.")}, added: tried(() => all.added) });\n`;
      const readers = {
        "readers/before.ts": byName,
        "readers/after.ts": byName,
        "readers/namespace.ts": namespace,
        "readers/after-namespace.ts": namespace,
        "readers/default.ts": byDefault,
        "readers/after-default.ts": byDefault,
        "readers/required.ts": required,
        "readers/after-required.ts": required,
        "readers/captured.ts": `${tried}import { ${imported[0]} } from "${spec}";\nconst held = ${imported[0]};\nexport const read = () => ({ same: tried(() => held === ${imported[0]}) });\n`,
      };
      const factoriesOf: Record<string, string> = {
        factory: `, () => ({ ${members}, added: 'mock added' })`,
        "with-default": `, () => { const all = { ${members}, added: 'mock added' }; return { ...all, default: all }; }`,
        spread: `, async importOriginal => { const original = await importOriginal(); return { ...original, ${members}, added: 'mock added' }; }`,
        spy: `, { spy: true }`,
        none: ``,
      };
      const look = `async function look(moment) {
  const readers = { before, namespace, "default": byDefault, required, captured,
    ...(moment === "0 loaded" ? {} : { after: await import("../readers/after.ts"), "after namespace": await import("../readers/after-namespace.ts"), "after default": await import("../readers/after-default.ts"), "after required": await import("../readers/after-required.ts") }),
    "import()": { read: await (async () => { const ns = await import("${spec}"); return () => ${through("ns.")}; })().catch(e => () => ({ load: "threw " + String(e.message).slice(0, 60) })) },
    "require()": { read: () => { const ns = require("${spec}"); return ${through("ns.")}; } } };
  ${print}
}
`;
      const imports = `import * as before from "../readers/before.ts";\nimport * as namespace from "../readers/namespace.ts";\nimport * as byDefault from "../readers/default.ts";\nimport * as required from "../readers/required.ts";\nimport * as captured from "../readers/captured.ts";\n`;
      const next = `import { test } from "bun:test";\n${tried}import * as before from "../readers/before.ts";\nimport * as namespace from "../readers/namespace.ts";\nimport * as byDefault from "../readers/default.ts";\nimport * as required from "../readers/required.ts";\ntest("the next file", () => { const moment = "5 next file", readers = { before, namespace, "default": byDefault, required }; ${print} });\n`;
      for (const [call, kinds] of Object.entries(callsOfBuiltins))
        for (const factory of kinds)
          for (const where of places(call))
            for (const realm of ["isolate", "one-realm"])
              projects.set(
                `${spec.replace(":", "_")}.${call}.${factory}.${where}.${realm}`,
                project(
                  {
                    ...readers,
                    "test/a.test.ts": body(imports, look, `${call}("${spec}"${factoriesOf[factory]})`, where, "", ends[call](spec)),
                    "test/b.test.ts": next,
                  },
                  where,
                  realm,
                ),
              );
      if (!["node:fs", "node:util", "bun"].includes(spec)) continue;
      const parts = { spec, specFromRoot: spec, factory: factoriesOf.factory, imports, look, acts: "" };
      for (const who of layers)
        for (const end of Object.keys(endings))
          for (const realm of ["isolate", "one-realm"])
            projects.set(
              `${spec.replace(":", "_")}.laid-by-${who}.${end}.${realm}`,
              project({ ...readers, ...laidByAnother(who, end, parts), "test/b.test.ts": next }, who, realm),
            );
    }
  return projects;
}

const list = join(import.meta.dir, "..", "mock-laid-over.known.txt");
const rewrite = !!process.env.BUN_AOT_REWRITE_MOCK_LAID_OVER;
const known = readFileSync(list, "utf8").split("\n");
const found: string[] = [];
const asked = new Set<string>();

async function keysOf(dir: string, flags: string[]) {
  const { stdout } = await run([bunExe(), "test", ...flags], dir, { ...bunEnv, NO_COLOR: "1" });
  const keys = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const at = line.indexOf(" = ");
    if (line.startsWith("KEY ") && at > 0) keys.set(line.slice(4, at), line.slice(at + 3));
  }
  return keys;
}

async function judge(name: string, { files, flags }: Project, fewestKeys: number) {
  using plainDir = tempDir("aot-mock-laid-over", files);
  using compiledDir = tempDir("aot-mock-laid-over", files);
  const [plain, compiled] = await Promise.all([keysOf(String(plainDir), flags), keysOf(String(compiledDir), ["--aot", ...flags])]);
  // A run in which plain printed little would pass for the wrong reason.
  expect(plain.size).toBeGreaterThan(fewestKeys);
  const moments = new Map<string, string[]>();
  for (const [key, expected] of plain) {
    const got = compiled.get(key) ?? "nothing";
    if (got === expected) continue;
    const parts = key.split(" | ");
    const [moment] = parts.splice(-3, 1);
    const line = `${name} | ${parts.join(" | ")}: ${/^(threw |nothing$)/.test(got) ? "loud" : "SILENT"} | ${got}`;
    moments.set(line, [...(moments.get(line) ?? []), moment[0]]);
  }
  const differing = [...moments].map(([line, at]) => `${line} | at ${at.sort().join(" ")}`).sort();
  asked.add(name);
  found.push(...differing);
  if (!rewrite) expect(differing).toEqual(known.filter(line => line.startsWith(name + " | ")));
}

// In front of a merge: the columns in which real programs were counted, and a witness for each fault that the grid has found.
const witnesses = [
  "project.mock.module.factory.top",
  "project.mock.module.factory.test",
  "project.mock.module.original.top",
  "project.mock.module.spread.test",
  "typed-package.mock.module.factory.top",
  "untyped-package.mock.module.factory.top",
  "project.vi.mock.factory.hoisted",
  "project.vi.mock.spy.hoisted",
  "project.vi.doMock.factory.test",
  "project.jest.mock.factory.hoisted",
  "node_fs.mock.module.factory.top",
  "node_path.mock.module.with-default.top",
  "os.vi.mock.factory.hoisted",
  "child_process.jest.mock.factory.hoisted",
  "bun.mock.module.factory.top",
  "bun_sqlite.mock.module.spread.test",
  "bun_sqlite.vi.mock.none.hoisted",
  "project.laid-by-preload.file-end",
  "project.laid-by-helper-import.file-end",
  "project.laid-by-helper-call.restore",
  "untyped-package.laid-by-preload.doUnmock",
  "node_util.laid-by-preload.file-end",
  "node_fs.laid-by-helper-import.file-end",
  "bun.laid-by-helper-call.doUnmock",
];

/** Many columns as one project: each in a folder of its own, its two test files in realms of their own, as `--isolate` gives every file. Two runs judge them all. */
export function packed(all: Map<string, Project>, columns: string[]): Project {
  const files: Record<string, string> = { ...root };
  const order: string[] = [];
  let preload = "";
  for (const column of columns) {
    const project = all.get(`${column}.isolate`)!;
    for (const [path, source] of Object.entries(project.files))
      files[`c/${column}/${path}`] = path.startsWith("test/") ? `globalThis.COLUMN = "${column}";\n${source}` : source;
    if (project.files["preload.ts"]) preload += `import "./c/${column}/preload.ts";\n`;
    order.push(`./c/${column}/test/a.test.ts`, `./c/${column}/test/b.test.ts`);
  }
  return { files: { ...files, "preload.ts": preload }, flags: ["--isolate", "--preload", "./preload.ts", ...order] };
}

/**
 * The cell in which real programs live: the module has run, then a mock is laid over it. What `bun test` prints is the specification, key by key.
 * In front of a merge: the columns as one project, twice: without a preload that lays a mock, and with, as large programs run. Four runs. A mock call in any preload
 * changes how the whole run answers: a fault of another column went out of sight beside one. AOT_WHOLE_GRIDS=1, on a bench: all 696 projects, each alone.
 * mock-laid-over.known.txt holds every key that differs, a line `<project> | <reader> | <export>: <loud | SILENT> | <what is printed> | at <the moments>`: a line that is
 * cured, one that changes and a new one all fail. BUN_AOT_REWRITE_MOCK_LAID_OVER=1 writes the lines of what ran anew.
 */
export function mockLaidOver() {
  const all = new Map([...modules(), ...builtinModules()]);
  const withoutMockingPreload = witnesses.filter(column => !column.includes(".laid-by-preload."));
  test("the columns of real programs and a witness for each fault", () => judge("packed", packed(all, withoutMockingPreload), 5000), 300_000);
  test("the same beside preloads that lay mocks", () => judge("packed beside preloads that mock", packed(all, witnesses), 5000), 300_000);
  if (runsWholeGrids) for (const [name, project] of all) test(name, () => judge(name, project, 10), 180_000);
  afterAll(() => {
    if (!rewrite) return;
    const now = readFileSync(list, "utf8").split("\n");
    const kept = now.filter(line => line && !line.startsWith("#") && !asked.has(line.split(" | ")[0]));
    writeFileSync(list, [...now.filter(line => line.startsWith("#")), ...[...kept, ...found].sort(), ""].join("\n"));
  });
}
