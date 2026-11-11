// A ring of files hands a name round and round: `export { n0 } from "./e0.mjs"` finds no declaration, so the load is refused with a SyntaxError, as the
// specification and Node say (plain Bun answers from the CommonJS file behind the star). Nothing of a refused load has run: a mock laid over one of its files
// waits for the first import, as over any file that has not loaded. It used to call the factory at once: the promise that vi.doMock() then returns was
// rejected a turn later, behind the end of the test, and the run ended with 1 or with 0 by whether the process still lived.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const ring = {
  "package.json": `{ "name": "made-up", "type": "module" }`,
  "e0.mjs": `export * from "./e3.mjs";\n`,
  "e1.mjs": `export * from "./e3.mjs";\n`,
  "e3.mjs": `export { n0 } from "./e0.mjs";\nexport * from "./e0.mjs";\nexport * from "./c0.cjs";\n`,
  "c0.cjs": `exports.n0 = "c0-n0";\nexports.only_c0 = 1;\n`,
};

const testFile = (early: string, mocked: string, call: (doMock: string) => string) => `
  import { test, vi } from "bun:test";
  test("the order", async () => {
    try { await import("./${early}"); console.log("SAID early loaded"); } catch (error) { console.log("SAID early", error.name); }
    ${call(`vi.doMock("./${mocked}", async original => { console.log("SAID the factory runs"); return { ...(await original()), extra: 1 }; })`)}
    console.log("SAID behind the call");
    try { await import("./${mocked}"); console.log("SAID loaded"); } catch (error) { console.log("SAID", error.name); }
  });
`;

async function said(early: string, mocked: string, call = (doMock: string) => `${doMock};`) {
  using dir = tempDir("a-mock-over-a-file-of-a-refused-load", { ...ring, "a.test.js": testFile(early, mocked, call) });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "./a.test.js"], String(dir), bunEnv);
  return {
    said: stdout
      .split("\n")
      .filter(line => line.startsWith("SAID "))
      .map(line => line.slice(5)),
    unhandled: stderr.includes("Unhandled error"),
    exitCode,
  };
}

const waits = { said: ["early SyntaxError", "behind the call", "SyntaxError"], unhandled: false, exitCode: 0 };

test("a member of the ring is mocked", async () => {
  expect(await said("e1.mjs", "e0.mjs")).toEqual(waits);
});

// The name is one that only the mock can have, and it has it: plain Bun answers so too.
test("the file that asks for the name is mocked, and answers", async () => {
  expect(await said("e1.mjs", "e3.mjs")).toEqual({
    ...waits,
    said: ["early SyntaxError", "behind the call", "the factory runs", "loaded"],
  });
});

test("the file that was imported early is the one that is mocked", async () => {
  expect(await said("e0.mjs", "e0.mjs")).toEqual(waits);
});

test("the call that is awaited settles", async () => {
  const awaited = (doMock: string) =>
    `try { await ${doMock}; console.log("SAID the call settled"); } catch (error) { console.log("SAID the call", error.name); }`;
  expect(await said("e1.mjs", "e0.mjs", awaited)).toEqual({
    ...waits,
    said: ["early SyntaxError", "the call settled", "behind the call", "SyntaxError"],
  });
});

test("the mock of the CommonJS file, which has run, waits too, and answers", async () => {
  expect(await said("e1.mjs", "c0.cjs")).toEqual({
    ...waits,
    said: ["early SyntaxError", "behind the call", "the factory runs", "loaded"],
  });
});
