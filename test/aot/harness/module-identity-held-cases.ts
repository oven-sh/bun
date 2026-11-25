// Cases for module-identity-held-*.test.ts: a namespace object is held while `bun test` loads the module that declares its property again.
//
// Every stage of a project prints one line, `SAID <kind>.<stage> <column>=<values> .. @<bodies that have run>`. It reads the same property of each held object three times:
// 300 times at one site, once at a site that nothing else uses, and through Reflect.get(). What a property is bound to does not depend on how it is read.
// Each project runs four times, and only the environment differs:
//   kept, collected   Closures of the instances that have run are kept, or garbage is collected between the stages.
//   warm, cold        The property is read before the module is loaded again, or nothing reads it before that. The caches are one table for a structure and a name, so a site that
//                     has not run before is not cold.
// The kinds of stages: `early`, before the module is loaded again; `late`, after that; `written`, after a write through a closure that only a `kept` run has.
import type { Case } from "./module-identity-cases";

/** What is held. `module` is the namespace object of the module itself, the others are barrels that re-export from it. Only `barrel-without-body` runs no statement. */
const heldObjects = [
  "module",
  "named-barrel",
  "barrel-without-body",
  "star-barrel",
  "namespace-barrel",
  "two-barrels",
] as const;
type HeldObject = (typeof heldObjects)[number];

/**
 * How the module is loaded again. A `loaded` mock is in force while the held object is imported a second time. `leaf` is a file that the module imports.
 * Except in `rerun-each-without-mock`, the test files name a mock of the module or of leaf, so the module is one that may run again.
 */
const ways = [
  "rerun-each",
  "failed-then-mocked",
  "failed-then-next-file",
  "mock-loaded",
  "leaf-mock-loaded",
  "mock",
  "rerun-each-without-mock",
  "leaf-mock",
  "mock-module-restored",
  "reset-modules",
  "require-cache",
  "plugin",
] as const;
type Way = (typeof ways)[number];

/** These ways run with every held object, each of the others with half of them. */
const waysWithEveryObject = 5;

const path = (object: HeldObject, module: string) => (object === "module" ? module : "./barrel.mjs");
const recordRun = (letter: string) => `(globalThis.ran ??= []).push("${letter}");`;
const readerImport = `import { closesOver, collect, directReads, earlyReads, reads, say, write } from "./reader.mjs";`;
const numberOfSites = 20;

function reader(object: HeldObject) {
  const property = object === "namespace-barrel" ? "space.value" : "value";
  const throughReflect =
    object === "namespace-barrel"
      ? `Reflect.get(Reflect.get(object, "space"), "value")`
      : `Reflect.get(object, "value")`;
  const sites = Array.from({ length: numberOfSites }, (_, at) => `once${at}`);
  return [
    ...sites.map(site => `export function ${site}(object) { return object.${property}; }`),
    `const sites = [${sites.join(", ")}];`,
    "globalThis.nextSite ??= 0;",
    `export function often(object) { let value; for (let i = 0; i < 300; i++) value = object.${property}; return value; }`,
    "export function oftenDirectly(module) { let value; for (let i = 0; i < 300; i++) value = module.value; return value; }",
    "export function onceDirectly(module) { return module.value; }",
    "const tryRead = read => { try { return String(read()); } catch (error) { return error.constructor.name; } };",
    `const rejected = object => object instanceof Error && "rejected:" + object.constructor.name;`,
    "export function reads(object) {",
    "  const once = sites[globalThis.nextSite++];",
    `  return rejected(object) || [tryRead(() => often(object)), tryRead(() => once(object)), tryRead(() => ${throughReflect})].join();`,
    "}",
    "export function directReads(module) {",
    `  return rejected(module) || [tryRead(() => oftenDirectly(module)), tryRead(() => onceDirectly(module)), tryRead(() => Reflect.get(module, "value"))].join();`,
    "}",
    `export const earlyReads = object => (process.env.READS === "cold" ? "unread" : reads(object));`,
    `const keeps = process.env.INSTANCES === "kept";`,
    "export function closesOver(bump) { if (keeps) (globalThis.kept ??= []).push(bump); }",
    "export function collect() { if (!keeps) Bun.gc(true); }",
    "export function write() { if (keeps) globalThis.kept[0](); }",
    `export function say(stage, ...columns) { console.log(["SAID", stage, ...columns, "@" + (globalThis.ran ?? []).join("")].join(" ")); }`,
    "",
  ].join("\n");
}

function barrelFiles(object: HeldObject, module: string): Record<string, string> {
  const named = (from: string) => `export { value, bump } from "${from}";`;
  switch (object) {
    case "module":
      return {};
    case "named-barrel":
      return { "barrel.mjs": `${named(module)}\n${recordRun("b")}\n` };
    case "barrel-without-body":
      return { "barrel.mjs": `${named(module)}\n` };
    case "star-barrel":
      return { "barrel.mjs": `export * from "${module}";\n${recordRun("b")}\n` };
    case "namespace-barrel":
      return { "barrel.mjs": `export * as space from "${module}";\n${recordRun("b")}\n` };
    case "two-barrels":
      return {
        "barrel.mjs": `${named("./inner.mjs")}\n${recordRun("b")}\n`,
        "inner.mjs": `${named(module)}\n${recordRun("i")}\n`,
      };
  }
}

const countRuns = `const run = globalThis.ran.filter(letter => letter === "d").length;`;
const moduleBody = [
  recordRun("d"),
  countRuns,
  "export let value = run * 100;",
  "export const bump = () => ++value;",
  "closesOver(bump);",
];
const leafFile = `${recordRun("l")}\nexport const leaf = "leaf";\n`;
const skippedMock = `test.skip("mocks", () => { vi.doMock("./leaf.mjs", () => ({ leaf: "mock" })); });`;
const mockOf = (call: string) => `${call}("./dep.mjs", () => ({ value: "mock", bump() {} }));`;
const orError = ".catch(error => error)";

function column(name: string, read = "reads") {
  const variable = name === "first" ? "globalThis.first" : name;
  return `"${name}=" + ${read}(${variable})`;
}

const identity = (newer: string, older: string) =>
  `"${newer}.is.${older}=" + (${newer} === ${older === "first" ? "globalThis.first" : older})`;
/** Only in a late stage: this reads the property that a cold run may not have read before. */
const spaceIdentity = (object: HeldObject) =>
  object === "namespace-barrel" ? [`"again.space.is.first.space=" + (again.space === globalThis.first.space)`] : [];

const testFile = (head: string[], body: string[], title = "main") =>
  [
    `import { test, vi, mock } from "bun:test";`,
    readerImport,
    ...head,
    `test("${title}", async () => {`,
    ...body.map(line => "  " + line),
    "});",
    "",
  ].join("\n");

/** The stages that follow the second import of the held object. */
function lateStages(object: HeldObject, hasMocked: boolean) {
  const heldColumns = [column("first"), ...(hasMocked ? [column("mocked")] : []), column("again")];
  const identities = [
    identity("again", "first"),
    ...spaceIdentity(object),
    ...(hasMocked ? [identity("again", "mocked"), identity("mocked", "first")] : []),
  ];
  return [
    "collect();",
    `say("late.again", ${[...heldColumns, ...identities].join(", ")});`,
    "collect();",
    `say("late.later", ${heldColumns.join(", ")});`,
    "write();",
    `say("written.kept", ${heldColumns.join(", ")});`,
    `const direct = await import("./dep.mjs")${orError};`,
    "direct.bump?.();",
    `say("written.direct", ${[...heldColumns, column("direct", "directReads")].join(", ")});`,
  ];
}

function rerunProject(object: HeldObject, hasMock: boolean) {
  const module = "./main.test.mjs";
  const reading = (names: string[]) => names.map(name => column(name, "read")).join(", ");
  return {
    files: {
      ...barrelFiles(object, module),
      "main.test.mjs": testFile(
        [`import { leaf } from "./leaf.mjs";`, ...moduleBody, ...(hasMock ? [skippedMock] : [])],
        [
          `const again = await import("${path(object, module)}");`,
          "globalThis.first ??= again;",
          `const [kind, read] = run === 1 ? ["early", earlyReads] : ["late", reads];`,
          "collect();",
          `say(kind + ".run" + run, ${reading(["first", "again"])}, ${identity("again", "first")}, "leaf=" + leaf);`,
          "bump();",
          `say(kind + ".bumped" + run, ${reading(["first", "again"])});`,
          "collect();",
          `say(kind + ".later" + run, ${reading(["first", "again"])});`,
          ...spaceIdentity(object).map(space => `if (run > 1) say("late.space" + run, ${space});`),
          "if (run < 3) return;",
          "write();",
          `say("written.kept", ${reading(["first", "again"])});`,
        ],
      ),
    },
    args: ["--rerun-each=3", module],
  };
}

/** The module throws when it first runs. What it imports of itself is held from then on. */
function failingModule(object: HeldObject) {
  return [
    `import * as held from "${path(object, "./dep.mjs")}";`,
    `import { closesOver } from "./reader.mjs";`,
    "globalThis.first ??= held;",
    ...moduleBody,
    `if (run === 1) throw new Error("first");`,
    "",
  ].join("\n");
}

function failedProject(object: HeldObject, hasNextFile: boolean) {
  const held = path(object, "./dep.mjs");
  const failedStage = [
    `const failed = await import("${held}").then(() => "loaded", error => error.message);`,
    "collect();",
    `say("early.failed", "failed=" + failed, ${column("first", "earlyReads")});`,
  ];
  const files = { ...barrelFiles(object, "./dep.mjs"), "dep.mjs": failingModule(object) };
  if (!hasNextFile)
    return {
      files: {
        ...files,
        "main.test.mjs": testFile(
          [],
          [
            ...failedStage,
            mockOf("vi.doMock"),
            `const mocked = await import("${held}")${orError};`,
            `say("early.mocked", ${column("first", "earlyReads")}, ${column("mocked", "earlyReads")}, ${identity("mocked", "first")});`,
            `vi.doUnmock("./dep.mjs");`,
            "collect();",
            `const again = await import("${held}")${orError};`,
            ...lateStages(object, true),
          ],
        ),
      },
      args: ["./main.test.mjs"],
    };
  const nextFile = (title: string, isLast: boolean) =>
    testFile(
      [],
      [
        "collect();",
        `const again = await import("${held}")${orError};`,
        `say("late.${title}", ${column("first")}, ${column("again")}, ${identity("again", "first")});`,
        "again.bump?.();",
        "collect();",
        `say("late.${title}-bumped", ${column("first")}, ${column("again")});`,
        ...(isLast ? ["write();", `say("written.kept", ${column("first")}, ${column("again")});`] : []),
      ],
      title,
    );
  return {
    files: {
      ...files,
      "main.test.mjs": testFile([`test.skip("mocks", () => { ${mockOf("vi.doMock")} });`], failedStage),
      "next.test.mjs": nextFile("next", false),
      "third.test.mjs": nextFile("third", true),
    },
    args: ["./main.test.mjs", "./next.test.mjs", "./third.test.mjs"],
  };
}

type StagedWay = Exclude<
  Way,
  "rerun-each" | "rerun-each-without-mock" | "failed-then-mocked" | "failed-then-next-file"
>;

function stagedProject(object: HeldObject, way: StagedWay) {
  const held = path(object, "./dep.mjs");
  const hasMocked = way === "mock-loaded" || way === "leaf-mock-loaded" || way === "mock-module-restored";
  // Only what an earlier test file has loaded runs again under a mock.
  const isMock = way.includes("mock");
  const firstStage = [
    `globalThis.first = await import("${held}");`,
    `say("early.first", ${column("first", "earlyReads")});`,
  ];
  const importMocked = `const mocked = await import("${held}")${orError};`;
  const mockLeaf = `vi.doMock("./leaf.mjs", () => ({ leaf: "mock" }));`;
  // Where the module itself is held, importing it would be the second import of the held object.
  const importDep = object === "module" ? [] : [`await import("./dep.mjs");`];
  const readMocked = `say("early.mocked", ${column("first", "earlyReads")}, ${column("mocked", "earlyReads")}, ${identity("mocked", "first")});`;
  const lines: Record<StagedWay, string[]> = {
    "mock-loaded": [mockOf("vi.doMock"), importMocked, readMocked, `vi.doUnmock("./dep.mjs");`],
    "leaf-mock-loaded": [mockLeaf, importMocked, readMocked, `vi.doUnmock("./leaf.mjs");`],
    "mock": [mockOf("vi.doMock"), ...importDep, `vi.doUnmock("./dep.mjs");`],
    "leaf-mock": [mockLeaf, `await import("./leaf.mjs");`, `vi.doUnmock("./leaf.mjs");`],
    "mock-module-restored": [mockOf("mock.module"), importMocked, readMocked, "mock.restore();"],
    "reset-modules": ["vi.resetModules();"],
    "require-cache": [`delete require.cache[require.resolve("./dep.mjs")];`],
    "plugin": [
      `Bun.plugin({ name: "replaces dep", setup(build) { build.onLoad({ filter: /dep\\.mjs$/ }, () => ({ exports: { value: "plugin", bump() {} }, loader: "object" })); } });`,
      `delete require.cache[require.resolve("./dep.mjs")];`,
    ],
  };
  return {
    files: {
      ...barrelFiles(object, "./dep.mjs"),
      "dep.mjs": [
        `import { leaf } from "./leaf.mjs";`,
        `import { closesOver } from "./reader.mjs";`,
        ...moduleBody,
        "export const seen = leaf;",
        "",
      ].join("\n"),
      ...(isMock && { "earlier.test.mjs": testFile([], firstStage, "earlier") }),
      "main.test.mjs": testFile(
        [
          ...(way === "require-cache" || way === "plugin"
            ? [`import { createRequire } from "node:module";`, "const require = createRequire(import.meta.url);"]
            : []),
          skippedMock,
        ],
        [
          ...(isMock ? [] : firstStage),
          ...lines[way],
          "collect();",
          `const again = await import("${held}")${orError};`,
          ...lateStages(object, hasMocked),
        ],
      ),
    },
    args: [...(isMock ? ["./earlier.test.mjs"] : []), "./main.test.mjs"],
  };
}

function projectOf(object: HeldObject, way: Way) {
  const { files, args } =
    way === "rerun-each" || way === "rerun-each-without-mock"
      ? rerunProject(object, way === "rerun-each")
      : way === "failed-then-mocked" || way === "failed-then-next-file"
        ? failedProject(object, way === "failed-then-next-file")
        : stagedProject(object, way);
  return {
    files: {
      "package.json": `{ "type": "module" }\n`,
      "reader.mjs": reader(object),
      "leaf.mjs": leafFile,
      ...files,
    } as Record<string, string>,
    args,
  };
}

/** Four runs of a project follow one another. */
export const heldRunsPerProject = 4;

export function heldNamespaceCases(): Case[] {
  const isLate = (title: string) => title.startsWith("late.");
  const isAfterEarly = (title: string) => !title.startsWith("early.");
  return ways.flatMap((way, wayIndex) =>
    heldObjects
      .filter((_, objectIndex) => wayIndex < waysWithEveryObject || (objectIndex + wayIndex) % 2 === 0)
      .flatMap(object => {
        const project = projectOf(object, way);
        const name = (instances: string, reads: string) => `${way} ${object} ${instances} ${reads}`;
        return ["kept", "collected"].flatMap(instances =>
          ["warm", "cold"].map(
            (reads): Case => ({
              variant: "held",
              name: name(instances, reads),
              ...project,
              subject: path(object, way.startsWith("rerun-each") ? "./main.test.mjs" : "./dep.mjs").slice("./".length),
              env: { INSTANCES: instances, READS: reads },
              agreesWith: [
                ...(reads === "cold"
                  ? [{ name: name(instances, "warm"), isCompared: isAfterEarly, failure: "depends on a cache" as const }]
                  : []),
                ...(instances === "collected"
                  ? [{ name: name("kept", reads), isCompared: isLate, failure: "depends on a collection" as const }]
                  : []),
              ],
            }),
          ),
        );
      }),
  );
}
