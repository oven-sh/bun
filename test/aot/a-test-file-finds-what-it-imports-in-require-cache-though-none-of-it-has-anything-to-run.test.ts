import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

const listsFilesOfSrc = `const listed = () => Object.keys(require.cache).filter(key => /[\\\\/]src[\\\\/]/.test(key)).map(key => key.replace(/.*[\\\\/]/, "")).sort().join();`;

const nothingToRun = {
  "src/constant.ts": `export const value = 7;`,
  "src/functions.ts": `export function three() { return 3; }`,
};

test("while the test file runs, and in a test", async () => {
  await expectCompiledToRunAsPlain({
    ...nothingToRun,
    "one.test.ts": `
      import { test } from "bun:test";
      import { value } from "./src/constant";
      import { three } from "./src/functions";
      ${listsFilesOfSrc}
      const atTop = listed();
      test("behind the imports", () => { console.log(atTop, "|", listed(), value, three()); });`,
  });
});

test("where a file of the program lists them", async () => {
  await expectCompiledToRunAsPlain({
    ...nothingToRun,
    "src/lists.ts": `${listsFilesOfSrc}\nexport { listed };`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { value } from "./src/constant";
      import { three } from "./src/functions";
      import { listed } from "./src/lists";
      const atTop = listed();
      test("behind the imports", () => { console.log(atTop, "|", listed(), value, three()); });`,
  });
});

test("below a file that a test loads later", async () => {
  await expectCompiledToRunAsPlain({
    ...nothingToRun,
    "src/counts.ts": `
      import { value } from "./constant";
      import { three } from "./functions";
      ${listsFilesOfSrc}
      const realm = globalThis as any;
      realm.counted = (realm.counted ?? 0) + value + three();
      export const seen = listed() + " " + realm.counted;`,
    "one.test.ts": `
      import { test } from "bun:test";
      ${listsFilesOfSrc}
      test("import()", async () => { console.log(listed()); console.log((await import("./src/counts")).seen); console.log(listed()); });`,
    "two.test.ts": `
      import { test } from "bun:test";
      ${listsFilesOfSrc}
      test("require()", () => { console.log(listed()); console.log(require("./src/counts").seen); console.log(listed()); });`,
  });
});
