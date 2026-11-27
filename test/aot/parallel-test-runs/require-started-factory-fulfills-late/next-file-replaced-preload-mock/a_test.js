import { test, vi } from "bun:test";
const word = load => load.then(it => String(it.x), error => error.name);
test("a", async () => {
  let said; try { said = String(require("./part.js").x); } catch (error) { said = error.name; }
  vi.doMock("./part.js", () => ({ x: "second mock" }));
  console.log("SAID a", said, globalThis.calls, await word(import("./part.js")));
});
