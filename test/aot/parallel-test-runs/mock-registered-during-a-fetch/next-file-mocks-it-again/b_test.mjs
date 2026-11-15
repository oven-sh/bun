import { test, vi } from "bun:test";
import { describeImport } from "./describe-import.mjs";
console.log("when the second file loads:", globalThis.evaluations ?? 0, "evaluations,", globalThis.factoryCalls ?? 0, "factory calls");
test("mocks the file again", async () => {
  vi.doMock("./part.mjs", () => ({ name: "second mock" }));
  globalThis.finishPart?.();
  const lines = [];
  for (const pending of globalThis.imports) lines.push(await describeImport(pending));
  const own = import("./part.mjs");
  lines.push(await describeImport(own), globalThis.evaluations ?? 0);
  lines.push((await own) === (await globalThis.imports[0]), (await own) === (await globalThis.imports[1]));
  console.log(lines.join(" | "));
});
