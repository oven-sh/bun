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
const testFile = (body: string, api = "vi", head = `import { seen } from "reads";`): Files => ({
  "a.test.js": `import { test, vi, jest } from "bun:test";\n${head}\n${api}.mock("dep", ${factory});\ntest("t", async () => { ${body} });\n`,
});
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

// TODO(bun): `differs`: compiled code hands the package the mock where the package calls import(), and where what it imports is a CommonJS file. Each goes red once it agrees.
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
      differs: files === commonJSDep || form === "import() in the package",
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
    differs: true,
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
    differs: true,
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
    words: "TestRunLayers:2",
  },
  ...Object.fromEntries(
    ["TestRunLayers:0", "TestRunLayers:2"].map(words => [
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
  // TODO(bun): `differs`: as one program the next test file runs the body again where the original was taken by a mock without a factory, or by vi.importActual().
  "a mock without a factory, then a test file that mocks nothing": {
    files: {
      ...countedDep,
      "a.test.js": `import { test, vi } from "bun:test";\nimport * as dep from "dep";\nvi.mock("dep");\ntest("a", () => console.log("SAID a " + [dep.a, typeof dep.fn, dep.fn(), vi.isMockFunction(dep.fn)]));\n`,
      "z.test.js": nextTestFile,
    },
    said: ["SAID the body runs 1", "SAID a real,function,,true", "SAID z real,function,1,0"],
    words: "TestRunLayers:0",
    differs: true,
  },
  "vi.importActual(), then a test file that mocks nothing": {
    files: {
      ...countedDep,
      "a.test.js": `import { test, vi } from "bun:test";\nvi.mock("dep", () => ({ a: "mock" }));\ntest("a", async () => { const actual = await vi.importActual("dep"); actual.inc(); console.log("SAID a " + [(await import("dep")).a, actual.a, actual.count]); });\n`,
      "z.test.js": nextTestFile,
    },
    said: ["SAID the body runs 1", "SAID a mock,real,1", "SAID z real,function,1,1"],
    words: "TestRunLayers:0",
    differs: true,
  },
  "a package imports what a mock without a factory stands for, over two layers": {
    files: {
      ...countedDep,
      ...reader(`import { a, fn } from "dep";\nexport const seen = () => a + fn();`),
      "a.test.js": `import { test, vi } from "bun:test";\nimport { seen } from "reads";\nimport { fn } from "dep";\nvi.mock("dep");\ntest("a", () => console.log("SAID a " + [seen(), fn(), vi.isMockFunction(fn)]));\n`,
      "z.test.js": nextTestFile,
    },
    said: ["SAID the body runs 1", "SAID a real1,,true", "SAID z real,function,1,0"],
    words: "TestRunLayers:2",
  },
  "the original's body throws": {
    files: { ...throwingDep, ...reader(forms["a name"]), ...testFile(say) },
    said: ["error: the body of dep throws"],
    exitCode: 1,
  },
});

for (const [name, { files, said, exitCode = 0, differs, words = "", staysCompiled }] of Object.entries(cases)) {
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
