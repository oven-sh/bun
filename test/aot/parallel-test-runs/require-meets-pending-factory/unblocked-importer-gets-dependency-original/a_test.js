import { test, vi } from "bun:test";
const DEP = "./dep.js";
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("t", async () => {
  globalThis.moment = "one";
  vi.doMock(DEP, () => new Promise(() => {}));
  console.log("SAID the module", await tried(() => import.meta.require(DEP).flag));
  console.log("SAID one", await tried(() => import.meta.require("./user.js").values()));
  globalThis.moment = "two";
  vi.doMock(DEP);
  console.log("SAID two", await tried(async () => import.meta.require("./user.js").values()));
  for (let job = 0; job < 20; job++) await 0;
  globalThis.moment = "three";
  console.log("SAID three", await tried(async () => import.meta.require("./user.js").values()));
});
test("behind", () => console.log("SAID behind"));
