import { test, expect } from "bun:test";
import * as ns from "./crate.cjs";
test("read", () => { console.log(String(ns.hidden), String(ns.alias), String(ns.default)); expect(ns.alias).toBe(4); });
