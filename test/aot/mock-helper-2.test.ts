import { head, judge, lays, looks, mocked, reads, real, runner, withHelper } from "./harness/mock-helper";

// ./harness/mock-helper.ts: who makes the call, and what only a body that runs again can give.
judge({
  "a function of it lays the mock: whoever calls it": {
    files: {
      "helper.js": `${runner}export function setupMocks() { vi.doMock("./tax.js", () => ({ rate: "mock rate" })); }`,
      "a.test.js": `import { setupMocks } from "./helper.js";\nsetupMocks();\n${looks("a")}`,
      "b.test.js": `import { setupMocks } from "./helper.js";\n${looks("b")}`,
      "c.test.js": `import { setupMocks } from "./helper.js";\nsetupMocks();\n${looks("c")}`,
    },
    said: [mocked("a"), real("b"), mocked("c")],
  },
  // The caller is the file of the function. `bun test` runs it again, and with it whatever imports it by a statement: the module whose body made the call.
  "its body calls a function of another file, which lays the mock": {
    files: {
      "mocks.js": `${runner}export function layTax() { mock.module("./tax.js", () => ({ rate: "mock rate" })); }`,
      "helper.js": `import { layTax } from "./mocks.js";\nlayTax();`,
      "a.test.js": withHelper("a"),
      "b.test.js": `import { layTax } from "./mocks.js";\nvoid layTax;\n${looks("b")}`,
      "c.test.js": withHelper("c"),
    },
    said: [mocked("a"), real("b"), mocked("c")],
    isWitness: true,
  },
  "its body lays one mock, and a function of it another": {
    files: {
      "fee.js": `export const fee = "real fee";`,
      "inner.js": `${runner}vi.doMock("./fee.js", () => ({ fee: "mock fee" }));
        export function setupMocks() { vi.doMock("./tax.js", () => ({ rate: "mock rate" })); }`,
      "helper.js": `import "./inner.js";\nexport { setupMocks } from "./inner.js";`,
      ...Object.fromEntries(
        ["a", "b", "c"].map(name => [
          `${name}.test.js`,
          `import { setupMocks } from "./helper.js";\n${name === "b" ? "void setupMocks" : "setupMocks()"};\n${head}test("${name}", async () => {
            console.log("OUT ${name}", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee);
          });`,
        ]),
      ),
    },
    said: ["OUT a mock rate | mock fee", "OUT b real rate | mock fee", "OUT c mock rate | mock fee"],
  },
  "behind an await of its body": {
    files: {
      "fee.js": `export const fee = "real fee";`,
      "helper.js": `${runner}await 0;\nvi.doMock("./tax.js", () => ({ rate: "mock rate" }));
        await new Promise(resolve => setTimeout(resolve, 1));\nvi.doMock("./fee.js", () => ({ fee: "mock fee" }));`,
      ...Object.fromEntries(
        ["a", "b", "z"].map(name => [
          `${name}.test.js`,
          `${name === "z" ? "" : `import "./helper.js";\n`}${head}test("${name}", async () => {
            console.log("OUT ${name}", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee);
          });`,
        ]),
      ),
    },
    said: ["OUT a mock rate | mock fee", "OUT b mock rate | mock fee", "OUT z real rate | real fee"],
  },
  "a CommonJS file": {
    files: {
      "fee.js": `export const fee = "real fee";`,
      "helper.cjs": `const { mock } = require("bun:test");\nmock.module("./tax.js", () => ({ rate: "mock rate" }));`,
      ...Object.fromEntries(
        ["a", "b", "z"].map(name => [
          `${name}.test.js`,
          `${name === "z" ? "" : `import "./helper.cjs";\n`}${head}test("${name}", async () => {
            console.log("OUT ${name}", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee);
          });`,
        ]),
      ),
    },
    said: ["OUT a mock rate | real fee", "OUT b mock rate | real fee", "OUT z real rate | real fee"],
  },
  // Whoever waits at an import() is on no stack, and it has laid no mock yet when the imported module lays its own.
  "it lays its mock behind its import() of another that lays one": {
    files: {
      "fee.js": `export const fee = "real fee";`,
      "inner.js": `${runner}vi.doMock("./fee.js", () => ({ fee: "mock fee" }));`,
      "helper.js": `${runner}await import("./inner.js");\nvi.doMock("./tax.js", () => ({ rate: "mock rate" }));`,
      ...Object.fromEntries(
        ["a", "b", "z"].map(name => [
          `${name}.test.js`,
          `${name === "z" ? "" : `import "./helper.js";\n`}${head}test("${name}", async () => {
            console.log("OUT ${name}", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee);
          });`,
        ]),
      ),
    },
    said: ["OUT a mock rate | mock fee", "OUT b mock rate | mock fee", "OUT z real rate | real fee"],
    compiledSays: ["OUT a mock rate | mock fee", "OUT b mock rate | real fee", "OUT z real rate | real fee"],
  },
  "it comes by import() in the test": {
    files: {
      "helper.js": lays("vi.doMock"),
      ...Object.fromEntries(
        ["a", "b"].map(name => [
          `${name}.test.js`,
          `${head}test("${name}", async () => { await import("./helper.js"); ${reads} console.log("OUT ${name}", tax.rate, "|", cart.price()); });`,
        ]),
      ),
    },
    said: [mocked("a"), mocked("b")],
  },
  "its factory takes the original": {
    files: {
      "helper.js": `${runner}vi.mock("./tax.js", async importOriginal => ({ ...(await importOriginal()), rate: "mock rate" }));`,
      ...Object.fromEntries(
        ["a", "b"].map(name => [
          `${name}.test.js`,
          `import "./helper.js";\n${head}test("${name}", async () => { ${reads} console.log("OUT ${name}", tax.rate, tax.other, "|", cart.price()); });`,
        ]),
      ),
      "z.test.js": looks("z"),
    },
    said: [
      "OUT a mock rate real other | price by mock rate",
      "OUT b mock rate real other | price by mock rate",
      real("z"),
    ],
  },
  "it mocks a package": {
    files: {
      "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
      "node_modules/pkg/index.js": `export const rate = "real rate";`,
      "helper.js": `${runner}vi.mock("pkg", () => ({ rate: "mock rate" }));`,
      ...Object.fromEntries(
        ["a", "b", "z"].map(name => [
          `${name}.test.js`,
          `${name === "z" ? "" : `import "./helper.js";\n`}${head}test("${name}", async () => { console.log("OUT ${name}", (await import("pkg")).rate); });`,
        ]),
      ),
    },
    said: ["OUT a mock rate", "OUT b mock rate", "OUT z real rate"],
  },
  "it exports what the mock holds": {
    files: {
      "helper.js": `${runner}export const spy = vi.fn(() => "spied");\nvi.mock("./tax.js", () => ({ rate: spy }));`,
      ...Object.fromEntries(
        ["a", "b"].map(name => [
          `${name}.test.js`,
          `import { spy } from "./helper.js";\n${head}test("${name}", async () => {
            const tax = await import("./tax.js");
            tax.rate();
            console.log("OUT ${name}", tax.rate === spy, spy.mock.calls.length);
          });`,
        ]),
      ),
    },
    said: ["OUT a true 1", "OUT b true 1"],
  },
  // The call that is made again has the helper for its caller. What its factory calls has a caller of its own.
  "its factory, called at once, has a file of another folder lay a mock by a relative name": {
    files: {
      "fee.js": `export const fee = "real fee of the root";`,
      "sub/fee.js": `export const fee = "real fee of sub";`,
      "sub/other.js": `${runner}export function layFee() { mock.module("./fee.js", () => ({ fee: "mock fee" })); }`,
      "helper.js": `${runner}import "./tax.js";\nimport { layFee } from "./sub/other.js";
        mock.module("./tax.js", () => { layFee(); return { rate: "mock rate" }; });`,
      ...Object.fromEntries(
        ["a", "b"].map(name => [
          `${name}.test.js`,
          `import "./helper.js";\n${head}test("${name}", async () => {
            console.log("OUT ${name}", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee, "|", (await import("./sub/fee.js")).fee);
          });`,
        ]),
      ),
    },
    said: ["OUT a mock rate | real fee of the root | mock fee", "OUT b mock rate | real fee of the root | mock fee"],
  },
  "vi.hoisted() in it": {
    files: {
      "helper.js": `${runner}const held = vi.hoisted(() => ({ rate: "hoisted rate" }));\nvi.mock("./tax.js", () => held);`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a", "hoisted rate"), mocked("b", "hoisted rate")],
  },
  "a variable of its body that the factory counts in": {
    files: {
      "helper.js": `${runner}let n = 0;\nvi.mock("./tax.js", () => ({ n: ++n }));`,
      ...Object.fromEntries(
        ["a", "b"].map(name => [
          `${name}.test.js`,
          `import "./helper.js";\n${head}test("${name}", async () => { console.log("OUT ${name}", (await import("./tax.js")).n); });`,
        ]),
      ),
    },
    said: ["OUT a 1", "OUT b 1"],
    compiledSays: ["OUT a 1", "OUT b 2"],
  },
  "a call under a condition that reads otherwise the second time": {
    files: {
      "helper.js": `${runner}if (!globalThis.seen) {\n  globalThis.seen = true;\n  vi.doMock("./tax.js", () => ({ rate: "mock rate" }));\n}`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a"), real("b")],
    compiledSays: [mocked("a"), mocked("b")],
  },
});
