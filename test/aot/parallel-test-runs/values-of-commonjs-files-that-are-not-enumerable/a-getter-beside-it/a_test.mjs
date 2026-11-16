import { expect, test } from "bun:test";
import * as ns from "./crate.cjs";
const { hidden, alias, default: value } = await import("./crate.cjs");
test("beside a getter a marked file shows its enumerable names alone", () => {
  expect(String(hidden)).toBe("undefined");
  expect(String(ns.hidden)).toBe("undefined");
  expect(String(alias)).toBe("4");
  expect(String(value)).toBe("2");
  expect(Object.keys(ns).join()).toBe("alias,default");
});
