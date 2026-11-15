import { expect, test } from "bun:test";
import * as ns from "./crate.cjs";
import { hidden as named } from "./crate.cjs";
const { hidden, default: value } = await import("./crate.cjs");
test("a value that is not enumerable is a name of the namespace object", async () => {
  expect(String(hidden)).toBe("1");
  expect(String(named)).toBe("1");
  expect(String(ns.hidden)).toBe("1");
  expect(String(value)).toBe("2");
  expect(String((await import("./crate.cjs")).hidden)).toBe("1");
  expect(Object.keys(ns).join()).toBe("default,hidden");
});
