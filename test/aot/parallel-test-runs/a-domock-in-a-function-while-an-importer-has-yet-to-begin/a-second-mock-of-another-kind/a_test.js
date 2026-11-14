import { test } from "bun:test";
import { layModule, mockModule } from "./wrap.js";
import { who } from "./dep.js";
import { via } from "./user.js";
mockModule(import.meta.dir + "/dep.js", () => ({ who: () => "first" }));
layModule(import.meta.dir + "/dep.js", () => ({ who: () => "second" }));
test("t", async () => {
  console.log("SAID in the test", who(), via(), (await import("./dep.js")).who());
});
