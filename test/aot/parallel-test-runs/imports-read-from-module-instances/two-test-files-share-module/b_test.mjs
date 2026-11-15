import { test, vi, jest, mock, spyOn } from "bun:test";
import { add, total } from "./lib.mjs";
import * as whole from "./lib.mjs";
test("reads", () => { let sum = 0; for (let i = 0; i < 300; i++) { add(1); sum += total + whole.total; } console.log("SAID b", sum, total, globalThis.ran); });
