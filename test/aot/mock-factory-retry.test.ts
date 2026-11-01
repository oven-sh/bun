// A mock's factory that takes `importOriginal` is laid over the original, so where it fails `bun test` keeps no record of the failure: the next import asks the factory again,
// and a module that imports the mocked one loads then. A factory without the parameter stands in place of the module, and its error stays with the loader.
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(240_000);

const test = oneAtATime.concurrent;

const factories = {
  "takes importOriginal": "importOriginal =>",
  "takes importOriginal and is async": "async importOriginal =>",
  "takes nothing": "() =>",
  "takes nothing and is async": "async () =>",
};

for (const [title, head] of Object.entries(factories)) {
  for (const cycle of [false, true]) {
    test(`a factory that ${title}${cycle ? ", of a module in a cycle" : ""}`, async () => {
      await expectCompiledToRunAsPlain({
        "a.ts": `${cycle ? `import "./b";\n` : ""}export const a = "real-a";\n`,
        "b.ts": `import { a } from "./a";\nexport const seen = () => a;\n`,
        "fails.test.ts": `
import { test, vi } from "bun:test";
let calls = 0;
vi.doMock("./a", ${head} {
  if (++calls === 1) throw new Error("the factory failed");
  return { a: "mocked-a" };
});
const said = value => (value instanceof Error ? value.message : value);
test("fails once", async () => {
  console.log("first:", said(await import("./b").then(it => it.seen(), error => error)));
  console.log("the module:", said(await import("./a").then(it => it.a, error => error)));
  console.log("its importer:", said(await import("./b").then(it => it.seen(), error => error)));
  console.log("calls:", calls);
});`,
      });
    });
  }
}
