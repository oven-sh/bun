import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A helper that the test file imports first mocks a module that the test file imports too. A graph is loaded before a module of it begins, so the
// module is linked when the helper mocks it. `bun test` runs its body then and there, once, whatever the factory is, lays the mock over it, and
// importOriginal(), vi.importActual() and jest.requireActual() answer that instance. Every module says when it runs.
const say = `function say(text) { (globalThis.said ??= []).push(text); }`;
const factories = {
  "a plain factory": `() => { say("factory"); return { rate: 0.5, currency: "USD", withTax: net => net }; }`,
  "an async factory": `async () => { say("factory"); await Promise.resolve(); return { rate: 0.5, currency: "USD", withTax: net => net }; }`,
  "importOriginal": `async importOriginal => { say("factory"); return { ...(await importOriginal()), currency: "USD" }; }`,
  "vi.importActual": `async () => { say("factory"); return { ...(await vi.importActual("./tax")), currency: "USD" }; }`,
  "jest.requireActual": `() => { say("factory"); return { ...jest.requireActual("./tax"), currency: "USD" }; }`,
};

const project = (factory: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
  "tax.ts": `${say}\nsay("tax");\nexport const rate = 0.2;\nexport let currency = "EUR";\nexport function withTax(net) { return net * (1 + rate); }\n`,
  "cart.ts": `${say}\nimport { currency, withTax } from "./tax";\nsay("cart");\nexport const price = net => withTax(net) + " " + currency;\n`,
  "mocks-tax.ts": `import { jest, vi } from "bun:test";\n${say}\nsay("helper");\nvi.mock("./tax", ${factory});\nimport { price as priceOfCart } from "./cart";\nexport const price = net => priceOfCart(net);\n`,
  "linked.test.ts": `import { price } from "./mocks-tax";\nimport { test } from "bun:test";\nimport * as tax from "./tax";\ntest("t", () => {\n  console.log("ANSWER", tax.rate, tax.currency, price(10));\n  console.log("SAID", globalThis.said.join(" "));\n});\n`,
});

const seen = async (dir: string, env: Record<string, string | undefined>, ...flags: string[]) => {
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], dir, env);
  return { exitCode, lines: stdout.split("\n").filter(line => /^(ANSWER|SAID) /.test(line)) };
};
const layers = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };

for (const [name, factory] of Object.entries(factories)) {
  test(`the real module runs first and once: ${name}`, async () => {
    using dir = tempDir("mock-linked", project(factory));
    const plain = await seen(String(dir), bunEnv);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines[1]).toBe("SAID tax factory cart helper");
    expect(await seen(String(dir), bunEnv, "--aot")).toEqual(plain);
  });
  // The importer lies in another image: its load is noted in the image of the module too.
  test(`over two layers: ${name}`, async () => {
    using dir = tempDir("mock-linked-layers", project(factory));
    expect(await seen(String(dir), layers, "--aot")).toEqual(await seen(String(dir), bunEnv));
  });
}

test("a package", async () => {
  using dir = tempDir("mock-linked-package", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "node_modules/rates/package.json": `{ "name": "rates", "main": "index.js", "type": "module" }`,
    "node_modules/rates/index.js": `(globalThis.said ??= []).push("rates"); export const base = 0.2; export function rate() { return "real"; }\n`,
    "invoice.ts": `import { rate } from "rates";\nexport const rates = () => rate();\n`,
    "mocks-rates.ts": `import { vi } from "bun:test";\n${say}\nvi.mock("rates", async importOriginal => { say("factory"); return { ...(await importOriginal()), rate: () => "mock" }; });\n`,
    "first.test.ts": `import "./mocks-rates";\nimport { test, vi } from "bun:test";\nimport * as rates from "rates";\nimport { rates as ofInvoice } from "./invoice";\ntest("t", async () => {\n  console.log("ANSWER", rates.base, rates.rate(), ofInvoice(), (await vi.importActual("rates")).rate());\n  console.log("SAID", globalThis.said.join(" "));\n});\n`,
  });
  const plain = await seen(String(dir), bunEnv);
  expect(plain).toEqual({ exitCode: 0, lines: ["ANSWER 0.2 mock mock real", "SAID rates factory"] });
  expect(await seen(String(dir), bunEnv, "--aot")).toEqual(plain);
});
