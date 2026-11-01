import { head, judge, lays, looks, mocked, reads, real, runner, withHelper } from "./harness/mock-helper";

// ./harness/mock-helper.ts: who imports it, how often its factory is called, and which of two is last.
judge({
  "two test files import it, a third nothing": {
    files: {
      "helper.js": lays(),
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
      "z.test.js": looks("z"),
    },
    said: [mocked("a"), mocked("b"), real("z")],
  },
  "mock.module": {
    files: {
      "helper.js": lays("mock.module"),
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a"), mocked("b")],
  },
  "vi.doMock": {
    files: {
      "helper.js": lays("vi.doMock"),
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a"), mocked("b")],
  },
  "the first and the third import it, the second does not": {
    files: {
      "helper.js": lays(),
      "a.test.js": withHelper("a"),
      "b.test.js": looks("b"),
      "c.test.js": withHelper("c"),
    },
    said: [mocked("a"), real("b"), mocked("c")],
  },
  "two mocks, one of them undone by the first file": {
    files: {
      "fee.js": `export const fee = "real fee";`,
      "helper.js": `${lays()}vi.mock("./fee.js", () => ({ fee: "mock fee" }));`,
      "a.test.js": `import "./helper.js";\n${head}afterEach(() => { vi.doUnmock("./fee.js"); });
        test("a", async () => { console.log("OUT a", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee); });`,
      "b.test.js": `import "./helper.js";\n${head}test("b", async () => { console.log("OUT b", (await import("./tax.js")).rate, "|", (await import("./fee.js")).fee); });`,
    },
    said: ["OUT a mock rate | mock fee", "OUT b mock rate | mock fee"],
  },
  "a factory that throws the second time": {
    files: {
      "helper.js": `${runner}vi.mock("./tax.js", () => {
        globalThis.calls = (globalThis.calls ?? 0) + 1;
        if (globalThis.calls === 2) throw new Error("the second time");
        return { rate: "mock rate" };
      });`,
      ...Object.fromEntries(
        ["a", "b"].map(name => [
          `${name}.test.js`,
          `import "./helper.js";\n${head}test("${name}", async () => { console.log("OUT ${name}", await import("./tax.js").then(tax => tax.rate, error => "threw " + error.message)); });`,
        ]),
      ),
    },
    said: ["OUT a mock rate", "OUT b threw the second time"],
  },
  // The call itself throws: the test file that imports the module fails to load, and the next one gets the mock.
  "a factory that is called at once and throws the second time": {
    files: {
      "helper.js": `${runner}import "./tax.js";\nmock.module("./tax.js", () => {
        globalThis.calls = (globalThis.calls ?? 0) + 1;
        if (globalThis.calls === 2) throw new Error("the second time");
        return { rate: "mock rate" };
      });`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
      "c.test.js": withHelper("c"),
      "z.test.js": looks("z"),
    },
    said: [mocked("a"), mocked("c"), real("z"), "error: the second time"],
  },
  "the factory is called once for each test file": {
    files: {
      "helper.js": `${runner}vi.mock("./tax.js", () => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { rate: "mock rate" }; });`,
      ...Object.fromEntries(
        ["a", "b", "c"].map(name => [
          `${name}.test.js`,
          `import "./helper.js";\n${head}test("${name}", async () => { ${reads} console.log("OUT ${name}", tax.rate, "| calls", globalThis.calls); });`,
        ]),
      ),
    },
    said: ["OUT a mock rate | calls 1", "OUT b mock rate | calls 2", "OUT c mock rate | calls 3"],
  },
  "the second file undoes it ahead of its import": {
    files: {
      "helper.js": lays(),
      "a.test.js": withHelper("a"),
      "b.test.js": `import "./helper.js";\n${head}test("b", async () => { vi.doUnmock("./tax.js"); ${reads} console.log("OUT b", tax.rate, "|", cart.price()); });`,
    },
    said: [mocked("a"), real("b")],
  },
  "below another module": {
    files: {
      "inner.js": lays(),
      "helper.js": `import "./inner.js";\nexport const outer = true;`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
      "z.test.js": looks("z"),
    },
    said: [mocked("a"), mocked("b"), real("z")],
  },
  // `bun test` runs the module that laid the mock again, and those that import it by a statement.
  "below a module that lays none and imports it by import()": {
    files: {
      "inner.js": lays(),
      "helper.js": `await import("./inner.js");\nexport const outer = true;`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a"), real("b")],
  },
  "two of them mock one module by mock.module: the outer is last": {
    files: {
      "inner.js": lays("mock.module", "inner rate"),
      "helper.js": `import "./inner.js";\n${lays("mock.module", "outer rate")}`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a", "outer rate"), mocked("b", "outer rate")],
  },
  "two of them mock one module by vi.mock, which is hoisted: the inner is last": {
    files: {
      "inner.js": lays("vi.mock", "inner rate"),
      "helper.js": `import "./inner.js";\n${lays("vi.mock", "outer rate")}`,
      "a.test.js": withHelper("a"),
      "b.test.js": withHelper("b"),
    },
    said: [mocked("a", "inner rate"), mocked("b", "inner rate")],
    isWitness: true,
  },
  ...Object.fromEntries(
    ["vi.mock", "mock.module"].map(call => [
      `imported second, behind what reads the mocked module, ${call}`,
      {
        files: {
          "helper.js": lays(call),
          ...Object.fromEntries(
            ["a", "b"].map(name => [
              `${name}.test.js`,
              `import { price } from "./cart.js";\nimport "./helper.js";\n${head}test("${name}", () => { console.log("OUT ${name}", price()); });`,
            ]),
          ),
        },
        said: ["OUT a price by mock rate", "OUT b price by mock rate"],
      },
    ]),
  ),
});
