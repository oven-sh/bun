import { test, vi } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x), error => error.name);
const asked = name => { try { return String(require(name).x); } catch (error) { return error.name; } };
test("a", async () => {
  const said = asked("./part.js");
  vi.doMock("./part.js", () => ({ x: "second mock" }));
  console.log("SAID a", said, globalThis.calls, "-");
});
