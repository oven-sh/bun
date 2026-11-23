// The statement finds the mock of the preload, so nothing below middle.mjs is loaded until the test asks for the original: the loader behind `require` reads all of it.
import { jest, test } from "bun:test";
import { name } from "./middle.mjs";
test("the original is required", () => {
  console.log(name, String(globalThis.seen));
  console.log(jest.requireActual("./middle.mjs").name, globalThis.seen.join(" "));
});
