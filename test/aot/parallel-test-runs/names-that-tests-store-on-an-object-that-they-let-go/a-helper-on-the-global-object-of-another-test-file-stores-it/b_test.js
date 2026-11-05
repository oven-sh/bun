import { test } from "bun:test";
globalThis.putFar = object => { object.__far = 1; };
globalThis.takeFar = object => { delete object.__far; };
test("b", () => {});
