import { test, vi } from "bun:test";
import * as top from "./dep.js";
vi.mock("./dep.js", () => ({ who: "of the file", other: "of the file too" }));
const say = (at, what) => console.log("SAID", at, what.who, what.other, Object.keys(what).sort().join("+"));
test("t", async () => {
  say("the top", top);
  await vi.mock("./dep.js");
  say("the top again", top);
  say("asked", await import("./dep.js"));
  say("by a statement", { who: (await import("./user.js")).viaUser() });
  say("a namespace", (await import("./later.js")).look());
});
