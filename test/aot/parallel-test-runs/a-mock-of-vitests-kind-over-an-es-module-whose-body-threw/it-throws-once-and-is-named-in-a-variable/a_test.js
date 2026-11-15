import { test, vi, mock, jest } from "bun:test";
const say = path => import(path).then(() => "loaded", error => error.message);
test("t", async () => {
  console.log("SAID", await say("./part.mjs"));
  vi.doMock("./part.mjs", () => ({ default: 1 }));
  console.log("SAID", await say("./part.mjs"));
});
