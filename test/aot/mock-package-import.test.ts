// Vitest leaves packages as they are: a package that imports a module gets the original of what `vi.mock()` mocked, and the files of the project get the mock.
// Jest's mocks reach packages too. Plain `bun test` says what is right. mock-package-original.test.ts has the packages that call require().
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

type Files = Record<string, string>;
const pkg = (name: string, type: string | null, text: string, main = "index.js"): Files => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", main, ...(type ? { type } : {}) }),
  [`node_modules/${name}/${main}`]: text,
});
const moduleDep = pkg(
  "dep",
  "module",
  `globalThis.order?.push("dep body");\nexport const helper = () => "real helper";\nexport const value = () => "real+" + helper();\nexport default { kind: "real default" };\n`,
);
const commonJSDep = pkg(
  "dep",
  null,
  `globalThis.order?.push("dep body");\nexports.helper = () => "real helper";\nexports.value = () => "real+" + exports.helper();\nexports.default = { kind: "real default" };\n`,
);
const awaitingDep = pkg(
  "dep",
  "module",
  `globalThis.order?.push("dep body begins");\nconst late = await new Promise(done => setTimeout(() => done("late"), 5));\nglobalThis.order?.push("dep body ends");\nexport const helper = () => "real helper " + late;\nexport const value = () => "real+" + helper();\n`,
);
const throwingDep = pkg(
  "dep",
  "module",
  `export const value = () => "real";\nthrow new Error("the body of dep throws");\n`,
);
const importingDep = pkg(
  "dep",
  "module",
  `import { deep } from "below";\nglobalThis.order?.push("dep body");\nexport const value = () => "real+" + deep();\n`,
);
const below = pkg("below", "module", `globalThis.order?.push("below body");\nexport const deep = () => "real deep";\n`);
const countedDep = pkg(
  "dep",
  "module",
  `globalThis.ran = (globalThis.ran ?? 0) + 1;\nconsole.log("SAID the body runs " + globalThis.ran);\nexport const a = "real";\nexport function fn() { return 1; }\nexport let count = 0;\nexport const inc = () => ++count;\n`,
);
const nextTestFile = `import { test } from "bun:test";\nimport * as dep from "dep";\ntest("z", () => console.log("SAID z " + [dep.a, typeof dep.fn, dep.fn(), dep.count]));\n`;
const early = pkg("early", "module", `(globalThis.order ??= []).push("early body");`);
const late = pkg("late", "module", `globalThis.order.push("late body");`);
const factory = `() => ({ value: () => "mocked", helper: () => "mocked helper", default: { kind: "mocked default" } })`;
const reader = (text: string, type: string | null = "module", main?: string) => pkg("reads", type, text, main);
const testFile = (body: string, api = "vi", head = `import { seen } from "reads";`, mock = factory): Files => ({
  "a.test.js": `import { test, vi, jest } from "bun:test";\n${head}\n${api}.mock("dep", ${mock});\ntest("t", async () => { ${body} });\n`,
});
// It lacks `helper` and `default`, and adds `extra`.
const otherNames = `() => ({ value: () => "mocked", extra: 1 })`;
const lateFactory = `async () => { await new Promise(done => setTimeout(done, 5)); return { value: () => "mocked", extra: 1 }; }`;
const importer = `export const seen = () => import("dep");`;
const catching = `export const seen = () => import("dep").then(d => d.value(), e => "caught " + e.message);`;
const countedValueDep = pkg(
  "dep",
  "module",
  `globalThis.ran = (globalThis.ran ?? 0) + 1;\nconsole.log("SAID the body runs " + globalThis.ran);\nexport const helper = () => "real helper";\nexport const value = () => "real+" + helper();\n`,
);
const countedAwaitingDep = pkg(
  "dep",
  "module",
  `globalThis.ran = (globalThis.ran ?? 0) + 1;\nconsole.log("SAID the body runs " + globalThis.ran);\nawait new Promise(done => setTimeout(done, 5));\nexport const value = () => "real";\n`,
);
const say = `console.log("SAID " + (await seen()));`;
const sayBoth = `console.log("SAID package " + seen() + " | test " + value());`;
const forms = {
  "a name": `import { value } from "dep";\nexport const seen = () => value();`,
  "the namespace": `import * as d from "dep";\nexport const seen = () => d.value() + "|" + Object.keys(d).sort();`,
  "the default": `import d from "dep";\nexport const seen = () => JSON.stringify(d.kind ?? d.default?.kind ?? Object.keys(d));`,
  "handed on by name": `export { value as seen } from "dep";`,
  "handed on by a star": `export * from "dep";\nimport { value } from "dep";\nexport const seen = () => value();`,
  "import() in the package": `export const seen = async () => (await import("dep")).value();`,
};
const saidByForm: Record<keyof typeof forms, string> = {
  "a name": "real+real helper",
  "the namespace": "real+real helper|default,helper,value",
  "the default": `"real default"`,
  "handed on by name": "real+real helper",
  "handed on by a star": "real+real helper",
  "import() in the package": "real+real helper",
};

const cases: Record<
  string,
  { files: Files; said: string[]; exitCode?: number; differs?: boolean; words?: string; staysCompiled?: boolean }
> = {};
for (const [dep, files] of [
  ["an ES module", moduleDep],
  ["a CommonJS file", commonJSDep],
] as const) {
  for (const form of Object.keys(forms) as (keyof typeof forms)[])
    cases[`${form} of ${dep}`] = {
      files: { ...files, ...reader(forms[form]), ...testFile(say) },
      said: ["SAID " + saidByForm[form]],
    };
}
const mockedByForm: Record<keyof typeof forms, string> = {
  "a name": "mocked",
  "the namespace": "mocked|default,helper,value",
  "the default": `"mocked default"`,
  "handed on by name": "mocked",
  "handed on by a star": "mocked",
  "import() in the package": "mocked",
};
// Node would read an ES module in a .js file of a package without a type as CommonJS. Vitest inlines such a file, so it gets the mock, as a file of the project does.
for (const [dep, files] of [
  ["an ES module", moduleDep],
  ["a CommonJS file", commonJSDep],
] as const) {
  for (const form of Object.keys(forms) as (keyof typeof forms)[])
    cases[`a package without a type: ${form} of ${dep}`] = {
      files: { ...files, ...reader(forms[form], null), ...testFile(say) },
      said: ["SAID " + mockedByForm[form]],
    };
  cases[`a package without a type, loaded by import(): ${dep}`] = {
    files: {
      ...files,
      ...reader(forms["a name"], null),
      ...testFile(`const { seen } = await import("reads"); ${say}`, "vi", ""),
    },
    said: ["SAID mocked"],
  };
}
Object.assign(cases, {
  "a package without a type has no type": {
    files: {
      ...reader("", null),
      "a.test.js": `import { test } from "bun:test";\nimport text from "reads/package.json" with { type: "text" };\ntest("t", () => console.log("SAID " + Object.keys(JSON.parse(text))));\n`,
    },
    said: ["SAID name,version,main"],
  },
  "a package without a type beside one with a type": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"], null),
      ...pkg("typed", "module", forms["a name"].replace("seen", "typed")),
      ...testFile(
        `console.log("SAID " + [seen(), typed()]);`,
        "vi",
        `import { seen } from "reads";\nimport { typed } from "typed";`,
      ),
    },
    said: ["SAID mocked,real+real helper"],
  },
  "jest.mock() reaches the package": {
    files: { ...moduleDep, ...reader(forms["a name"]), ...testFile(say, "jest") },
    said: ["SAID mocked"],
  },
  "a file of the project gets the mock": {
    files: { ...moduleDep, "own.js": forms["a name"], ...testFile(say, "vi", `import { seen } from "./own.js";`) },
    said: ["SAID mocked"],
  },
  "the package's file is .mjs": {
    files: { ...moduleDep, ...reader(forms["a name"], null, "index.mjs"), ...testFile(say) },
    said: ["SAID real+real helper"],
  },
  "import() twice": {
    files: { ...moduleDep, ...reader(forms["import() in the package"]), ...testFile(say + " " + say) },
    said: ["SAID real+real helper", "SAID real+real helper"],
  },
  "the package and the test file each have their own": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      ...testFile(sayBoth, "vi", `import { seen } from "reads";\nimport { value } from "dep";`),
    },
    said: ["SAID package real+real helper | test mocked"],
  },
  "the test file imports first": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      ...testFile(sayBoth, "vi", `import { value } from "dep";\nimport { seen } from "reads";`),
    },
    said: ["SAID package real+real helper | test mocked"],
  },
  "the original's body runs in front of the package's": {
    files: {
      ...moduleDep,
      ...early,
      ...late,
      ...reader(`globalThis.order.push("reads body begins");\n` + forms["a name"]),
      ...testFile(
        `console.log("SAID " + seen() + " | " + globalThis.order);`,
        "vi",
        `import "early";\nimport { seen } from "reads";\nimport "late";`,
      ),
    },
    said: ["SAID real+real helper | early body,dep body,reads body begins,late body"],
  },
  "a package below a package": {
    files: {
      ...moduleDep,
      ...pkg("middle", "module", `import { value } from "dep";\nexport const inner = () => value();`),
      ...reader(`import { inner } from "middle";\nexport const seen = () => inner();`),
      ...testFile(say),
    },
    said: ["SAID real+real helper"],
  },
  "vi.doMock(), then import() of the package": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      "a.test.js": `import { test, vi } from "bun:test";\ntest("t", async () => { vi.doMock("dep", ${factory}); console.log("SAID " + (await import("reads")).seen()); });\n`,
    },
    said: ["SAID real+real helper"],
  },
  "the factory takes importOriginal": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nimport { value, helper } from "dep";\nvi.mock("dep", async importOriginal => ({ ...(await importOriginal()), value: () => "mocked" }));\ntest("t", () => console.log("SAID package " + seen() + " | test " + value() + " " + helper()));\n`,
    },
    said: ["SAID package real+real helper | test mocked real helper"],
  },
  "a second test file mocks nothing and reads everything": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      ...testFile(say),
      "b.test.js": `import { test } from "bun:test";\nimport { seen } from "reads";\nimport * as d from "dep";\nimport dflt, { value, helper } from "dep";\ntest("t", async () => console.log("SAID second " + [seen(), value(), helper(), d.value(), dflt.kind, Object.keys(d).sort(), (await import("dep")).value()].join(" | ")));\n`,
    },
    said: [
      "SAID real+real helper",
      "SAID second real+real helper | real+real helper | real helper | real+real helper | real default | default,helper,value | real+real helper",
    ],
  },
  "the original awaits at top level": {
    files: {
      ...awaitingDep,
      ...early,
      ...reader(`globalThis.order.push("reads body begins");\n` + forms["a name"]),
      ...testFile(
        `console.log("SAID " + seen() + " | " + globalThis.order);`,
        "vi",
        `import "early";\nimport { seen } from "reads";`,
      ),
    },
    said: ["SAID real+real helper late | early body,dep body begins,dep body ends,reads body begins"],
  },
  "the original awaits at top level, behind import()": {
    files: { ...awaitingDep, ...reader(forms["import() in the package"]), ...testFile(say) },
    said: ["SAID real+real helper late"],
  },
  "the original has an import of its own": {
    files: {
      ...importingDep,
      ...below,
      ...early,
      ...reader(`globalThis.order.push("reads body begins");\n` + forms["a name"]),
      ...testFile(
        `console.log("SAID " + seen() + " | " + globalThis.order);`,
        "vi",
        `import "early";\nimport { seen } from "reads";`,
      ),
    },
    said: ["SAID real+real deep | early body,below body,dep body,reads body begins"],
  },
  "the original imports what the test mocks too": {
    files: {
      ...importingDep,
      ...below,
      ...reader(forms["a name"]),
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nimport { deep } from "below";\nvi.mock("dep", ${factory});\nvi.mock("below", () => ({ deep: () => "mocked deep" }));\ntest("t", () => console.log("SAID package " + seen() + " | test " + deep()));\n`,
    },
    said: ["SAID package real+real deep | test mocked deep"],
  },
  "the original imports the package that imports it": {
    files: {
      ...pkg("dep", "module", `import { seen } from "reads";\nexport const value = () => "real+" + typeof seen;\n`),
      ...reader(forms["a name"]),
      ...testFile(say),
    },
    said: ["SAID real+function"],
  },
  "the body does not run again behind vi.doUnmock()": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nglobalThis.order = [];\nvi.mock("dep", ${factory});\ntest("t", async () => { const a = seen(); const b = (await import("dep")).value(); vi.doUnmock("dep"); const c = (await import("dep")).value(); console.log("SAID " + [a, b, c, seen(), globalThis.order].join(" | ")); });\n`,
    },
    said: ["SAID real+real helper | mocked | real+real helper | real+real helper | "],
  },
  "the same over two layers": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nglobalThis.order = [];\nvi.mock("dep", ${factory});\ntest("t", async () => { const a = seen(); const b = (await import("dep")).value(); vi.doUnmock("dep"); const c = (await import("dep")).value(); console.log("SAID " + [a, b, c, seen(), globalThis.order].join(" | ")); });\n`,
    },
    said: ["SAID real+real helper | mocked | real+real helper | real+real helper | "],
    words: "TestRunLayers:0",
  },
  ...Object.fromEntries(
    ["TestRunLayers:0"].map(words => [
      `the original that a factory took is the package in the next test file, ${words}`,
      {
        files: {
          ...pkg(
            "dep",
            "module",
            `globalThis.ran = (globalThis.ran ?? 0) + 1;\nconsole.log("SAID the body runs " + globalThis.ran);\nexport const a = "real";\nexport function fn() { return 1; }\nexport let count = 0;\nexport const inc = () => ++count;\n`,
          ),
          "a.test.js": `import { test, vi } from "bun:test";\ntest("a", async () => {\n  vi.doMock("dep", async importOriginal => { const original = await importOriginal(); globalThis.original = original; original.inc(); return { ...original, a: "mock" }; });\n  console.log("SAID a " + (await import("dep")).a);\n});\n`,
          "z.test.js": `import { test } from "bun:test";\nimport * as dep from "dep";\ntest("z", () => { console.log("SAID z " + [dep.a, dep.fn === globalThis.original.fn, dep.count]); console.log("TEXT " + String(dep.fn).length); });\n`,
        },
        said: ["SAID the body runs 1", "SAID a mock", "SAID z real,true,1"],
        words,
        staysCompiled: true,
      },
    ]),
  ),
  "a mock without a factory, then a test file that mocks nothing": {
    files: {
      ...countedDep,
      "a.test.js": `import { test, vi } from "bun:test";\nimport * as dep from "dep";\nvi.mock("dep");\ntest("a", () => console.log("SAID a " + [dep.a, typeof dep.fn, dep.fn(), vi.isMockFunction(dep.fn)]));\n`,
      "z.test.js": nextTestFile,
    },
    said: ["SAID the body runs 1", "SAID a real,function,,true", "SAID z real,function,1,0"],
    words: "TestRunLayers:0",
  },
  "vi.importActual(), then a test file that mocks nothing": {
    files: {
      ...countedDep,
      "a.test.js": `import { test, vi } from "bun:test";\nvi.mock("dep", () => ({ a: "mock" }));\ntest("a", async () => { const actual = await vi.importActual("dep"); actual.inc(); console.log("SAID a " + [(await import("dep")).a, actual.a, actual.count]); });\n`,
      "z.test.js": nextTestFile,
    },
    said: ["SAID the body runs 1", "SAID a mock,real,1", "SAID z real,function,1,1"],
    words: "TestRunLayers:0",
  },
  "a package imports what a mock without a factory stands for, over two layers": {
    files: {
      ...countedDep,
      ...reader(`import { a, fn } from "dep";\nexport const seen = () => a + fn();`),
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nimport { fn } from "dep";\nvi.mock("dep");\ntest("a", () => console.log("SAID a " + [seen(), fn(), vi.isMockFunction(fn)]));\n`,
      "z.test.js": nextTestFile,
    },
    said: ["SAID the body runs 1", "SAID a real1,,true", "SAID z real,function,1,0"],
    words: "TestRunLayers:0",
  },
  "import(): the names are the module's own": {
    files: {
      ...moduleDep,
      ...reader(
        `export const seen = async () => { const o = await import("dep"); return o.value() + "|" + Object.keys(o).sort(); };`,
      ),
      ...testFile(say, "vi", undefined, otherNames),
    },
    said: ["SAID real+real helper|default,helper,value"],
  },
  "import() by the package and by the test file in one turn": {
    files: {
      ...moduleDep,
      ...reader(importer),
      ...testFile(
        `const [a, b, c] = await Promise.all([seen(), import("dep"), seen()]); console.log("SAID " + [a.value(), b.value(), c.value(), a === c, a === b]);`,
        "vi",
        undefined,
        otherNames,
      ),
    },
    said: ["SAID real+real helper,mocked,real+real helper,true,false"],
    words: "TestRunLayers:0",
  },
  "import() by the package and by the test file in one turn, over layers": {
    files: {
      ...moduleDep,
      ...reader(importer),
      ...testFile(
        `const [a, b, c] = await Promise.all([seen(), import("dep"), seen()]); console.log("SAID " + [a.value(), b.value(), c.value(), a === c, a === b]);`,
        "vi",
        undefined,
        otherNames,
      ),
    },
    said: ["SAID real+real helper,mocked,real+real helper,true,false"],
    words: "TestRunLayers:0",
  },
  "import() behind the test file's own": {
    files: {
      ...moduleDep,
      ...reader(importer),
      ...testFile(
        `const t = await import("dep"); const p = await seen(); const t2 = await import("dep"); console.log("SAID " + [t.value(), p.value(), t2.value(), t === t2, p === t]);`,
        "vi",
        undefined,
        otherNames,
      ),
    },
    said: ["SAID mocked,real+real helper,mocked,true,false"],
    words: "TestRunLayers:0",
  },
  "import() behind the test file's own, over layers": {
    files: {
      ...moduleDep,
      ...reader(importer),
      ...testFile(
        `const t = await import("dep"); const p = await seen(); const t2 = await import("dep"); console.log("SAID " + [t.value(), p.value(), t2.value(), t === t2, p === t]);`,
        "vi",
        undefined,
        otherNames,
      ),
    },
    said: ["SAID mocked,real+real helper,mocked,true,false"],
    words: "TestRunLayers:0",
  },
  "import(): the body runs behind the call": {
    files: {
      ...moduleDep,
      ...reader(
        `export const seen = () => { globalThis.order.push("call"); const p = import("dep"); globalThis.order.push("behind the call"); return p; };`,
      ),
      ...testFile(
        `globalThis.order = []; const d = await seen(); console.log("SAID " + d.value() + " | " + globalThis.order);`,
      ),
    },
    said: ["SAID real+real helper | call,behind the call,dep body"],
  },
  "import(), then a test file that mocks nothing": {
    files: {
      ...moduleDep,
      ...reader(importer),
      ...testFile(`console.log("SAID a " + (await seen()).value());`),
      "z.test.js": `import { test } from "bun:test";\nimport * as d from "dep";\nimport { seen } from "reads";\ntest("z", async () => console.log("SAID z " + [d.value(), (await seen()).value(), (await seen()) === d]));\n`,
    },
    said: ["SAID a real+real helper", "SAID z real+real helper,real+real helper,true"],
  },
  "import() under a factory that comes late": {
    files: {
      ...moduleDep,
      ...reader(forms["import() in the package"]),
      ...testFile(say, "vi", undefined, lateFactory),
    },
    said: ["SAID real+real helper"],
  },
  "a statement under a factory that comes late": {
    files: {
      ...moduleDep,
      ...reader(forms["a name"]),
      ...testFile(
        `console.log("SAID " + [seen(), value()]);`,
        "vi",
        `import { seen } from "reads";\nimport { value } from "dep";`,
        lateFactory,
      ),
    },
    said: ["SAID real+real helper,mocked"],
  },
  "import(): the original's body throws": {
    files: { ...throwingDep, ...reader(catching), ...testFile(say + " " + say) },
    said: ["SAID caught the body of dep throws", "SAID caught the body of dep throws"],
  },
  "two import()s at once of an original that awaits": {
    files: {
      ...countedAwaitingDep,
      ...reader(importer),
      ...testFile(
        `const [a, b] = await Promise.all([seen(), seen()]); console.log("SAID " + [a.value(), b.value(), a === b]);`,
      ),
    },
    said: ["SAID the body runs 1", "SAID real,real,true"],
  },
  "a statement and an import() of an original that awaits": {
    files: {
      ...countedAwaitingDep,
      ...reader(
        `import { value } from "dep";\nexport const seen = async () => [value(), (await import("dep")).value()];`,
      ),
      ...testFile(say),
    },
    said: ["SAID the body runs 1", "SAID real,real"],
  },
  "a CommonJS file of a package calls import()": {
    files: {
      ...moduleDep,
      ...reader(`exports.seen = async () => (await import("dep")).value();`, null),
      ...testFile(say),
    },
    said: ["SAID real+real helper"],
  },
  "a second mock over the first": {
    files: {
      ...countedValueDep,
      ...reader(forms["a name"]),
      ...testFile(
        `console.log("SAID " + seen()); vi.doMock("dep", () => ({ value: () => "second" })); console.log("SAID " + [seen(), (await import("dep")).value(), seen()]);`,
      ),
    },
    said: ["SAID the body runs 1", "SAID real+real helper", "SAID real+real helper,second,real+real helper"],
  },
  "vi.resetModules() while the mock stands": {
    files: {
      ...countedValueDep,
      ...reader(forms["a name"]),
      ...testFile(
        `console.log("SAID " + seen()); vi.resetModules(); const again = await import("reads"); console.log("SAID " + [seen(), again.seen(), again.seen === seen, (await import("dep")).value()]);`,
      ),
    },
    said: ["SAID the body runs 1", "SAID real+real helper", "SAID real+real helper,real+real helper,true,mocked"],
  },
  "a file of the project reads a package that an earlier test file loaded, over layers: an ES module": {
    files: {
      ...pkg("dep", "module", `export const flag = "real";\n`),
      "user.js": `import { flag } from "dep";\nexport const read = () => flag;\n`,
      "a.test.js": `import { test } from "bun:test";\nimport { read } from "./user.js";\ntest("a", () => console.log("SAID a " + read()));\n`,
      "b.test.js": `import { test, vi } from "bun:test";\nimport { read } from "./user.js";\nvi.mock("dep", () => ({ flag: "mock" }));\ntest("b", () => console.log("SAID b " + read()));\n`,
      "c.test.js": `import { test } from "bun:test";\nimport { read } from "./user.js";\ntest("c", () => console.log("SAID c " + read()));\n`,
    },
    said: ["SAID a real", "SAID b mock", "SAID c real"],
    words: "TestRunLayers:0",
  },
  "a file of the project reads a package that an earlier test file loaded, over layers: a CommonJS file": {
    files: {
      ...pkg("dep", null, `exports.flag = "real";\n`),
      "user.js": `import { flag } from "dep";\nexport const read = () => flag;\n`,
      "a.test.js": `import { test } from "bun:test";\nimport { read } from "./user.js";\ntest("a", () => console.log("SAID a " + read()));\n`,
      "b.test.js": `import { test, vi } from "bun:test";\nimport { read } from "./user.js";\nvi.mock("dep", () => ({ flag: "mock" }));\ntest("b", () => console.log("SAID b " + read()));\n`,
      "c.test.js": `import { test } from "bun:test";\nimport { read } from "./user.js";\ntest("c", () => console.log("SAID c " + read()));\n`,
    },
    said: ["SAID a real", "SAID b mock", "SAID c real"],
    words: "TestRunLayers:0",
  },
  "the original's body throws": {
    files: { ...throwingDep, ...reader(forms["a name"]), ...testFile(say) },
    said: ["error: the body of dep throws"],
    exitCode: 1,
  },
});

type Case = (typeof cases)[string];
// A case of one test file that passes runs beside the others, in one run of each kind: in a folder of its own with its packages below it, and in a realm of its own.
const runsBesideOthers = ({ files, exitCode, words, staysCompiled }: Case) =>
  !exitCode && !words && !staysCompiled && Object.keys(files).filter(path => path.endsWith(".test.js")).length === 1;
const beside = Object.entries(cases).filter(([, one]) => runsBesideOthers(one));
const idOf = (index: number) => `c${String(index).padStart(2, "0")}`;
let runs: Promise<{ plain: Map<string, string[]>; compiled: Map<string, string[]> }> | undefined;
const runAllBesideEachOther = () =>
  (runs ??= (async () => {
    const all: Files = { "package.json": `{ "type": "module" }` };
    beside.forEach(([, { files }], index) => {
      for (const [path, text] of Object.entries(files))
        all[`${idOf(index)}/${path}`] = text.replaceAll("SAID ", `SAID ${idOf(index)} `);
    });
    using dir = tempDir("aot-mock-package-import", all);
    const saidWith = async (...flags: string[]) => {
      const { stdout, stderr } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), bunEnv);
      const said = new Map<string, string[]>();
      for (const [, id, text] of (stdout + "\n" + stderr).matchAll(/^SAID (c\d+) (.*)$/gm))
        said.set(id, [...(said.get(id) ?? []), "SAID " + text]);
      return said;
    };
    return { plain: await saidWith(), compiled: await saidWith("--aot") };
  })());
beside.forEach(([name, { said, differs }], index) => {
  test(name, async () => {
    const { plain, compiled } = await runAllBesideEachOther();
    expect(plain.get(idOf(index)) ?? []).toEqual(said);
    if (differs) expect(compiled.get(idOf(index)) ?? []).not.toEqual(said);
    else expect(compiled.get(idOf(index)) ?? []).toEqual(said);
  });
});

for (const [name, one] of Object.entries(cases)) {
  if (runsBesideOthers(one)) continue;
  const { files, said, exitCode = 0, differs, words = "", staysCompiled } = one;
  test(name, async () => {
    using dir = tempDir("aot-mock-package-import", { "package.json": `{ "type": "module" }`, ...files });
    const texts: string[] = [];
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: words,
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      texts.push(lines.filter(line => line.startsWith("TEXT ")).join());
      return { said: lines.filter(line => line.startsWith("SAID ") || /^error|Error: /.test(line)), exitCode };
    };
    const plain = await seenWith();
    expect(plain).toEqual({ said, exitCode });
    if (differs) expect(await seenWith("--aot")).not.toEqual(plain);
    else expect(await seenWith("--aot")).toEqual(plain);
    // A compiled function shows the text of the file, a function that the loader read from disk what the transpiler printed.
    if (staysCompiled) expect(texts).toEqual(["TEXT 29", "TEXT 27"]);
  });
}
