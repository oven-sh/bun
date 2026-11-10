import { test, vi } from "bun:test";
import { who } from "./dep.mjs";
let runs = 0;
export let shown = 0;
const made = {};
function bump() {
  shown++;
  return ++runs;
}
export function peek() {
  return runs + "/" + shown;
}
globalThis.kept ??= [];
globalThis.kept.push(made, bump, peek);
test("each run has its own variables and functions", () => {
  const [firstMade, firstBump, firstPeek] = globalThis.kept;
  console.log("this run", bump(), shown, who, globalThis.kept.length, firstMade === made, firstBump === bump, firstPeek === peek);
  console.log("the first run", firstBump(), firstPeek(), "this run", peek());
});
test.skip("names the mocked file", () => {
  vi.doMock("./dep.mjs", () => ({ who: "mock" }));
});
