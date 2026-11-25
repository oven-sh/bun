import { test, vi } from "bun:test";
const asked = () => { try { return String(require("./kiln.js").heat); } catch (error) { return error.constructor.name; } };
test("a", async () => {
  let give;
  vi.doMock("./kiln.js", () => new Promise(gives => { give = gives; }));
  const early = import("./kiln.js").then(it => String(it.heat), error => error.constructor.name);
  console.log(asked());
  give({ heat: "mock" });
  console.log(await early);
});
