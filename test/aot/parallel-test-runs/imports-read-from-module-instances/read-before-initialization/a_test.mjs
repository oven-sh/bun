import { test, vi, jest, mock, spyOn } from "bun:test";
import { peek } from "./first.mjs";
test("reads", () => { console.log("SAID", peek(), globalThis.early); });
