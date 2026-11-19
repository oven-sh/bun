import { test, vi } from "bun:test";
const say = (when, load) => { let said; try { said = load().look(); } catch (error) { said = error.name; } console.log("SAID", when, said); };
test("required", () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  say("under", () => require("./user.mjs"));
  vi.doUnmock("./shapes.mjs");
  say("behind", () => require("./user.mjs"));
  say("again", () => require("./user.mjs"));
  say("a third time", () => require("./user.mjs"));
});
