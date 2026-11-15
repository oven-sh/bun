import { test, vi } from "bun:test";
const say = path => import(path).then(held => "loaded " + held.get?.(), error => error.message);
test("t", async () => {
  console.log("SAID", await say("./part.mjs"));
  vi.doMock("./part.mjs", () => ({ get: () => "mocked" }));
  console.log("SAID", await say("./user.mjs"));
});
