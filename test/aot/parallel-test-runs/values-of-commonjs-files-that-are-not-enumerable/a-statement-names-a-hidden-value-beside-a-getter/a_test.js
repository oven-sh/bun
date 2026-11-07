import { test, expect } from "bun:test";
import { hidden, alias } from "./crate.cjs";
test("named", () => { console.log(String(hidden), String(alias)); expect(alias).toBe(4); });
