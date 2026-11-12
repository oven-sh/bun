import { createRequire } from "node:module";
import { jest, mock, test, vi } from "bun:test";
const ask = async label => console.log("SAID", label, await import("./part.mjs").then(it => it.word, error => error.message), globalThis.runs);
test("b", async () => {
  await ask("b");
});
