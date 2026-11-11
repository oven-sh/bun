import { test, vi } from "bun:test";
import { say } from "./user.mjs";
vi.mock("./unit.json", async original => { const note = text => (globalThis.order ??= []).push(text);  note("u<"); await 0; note("u>"); return { kept: "mock", default: "mock" }; });
test("a", () => {
  console.log("SAID", say());
});
