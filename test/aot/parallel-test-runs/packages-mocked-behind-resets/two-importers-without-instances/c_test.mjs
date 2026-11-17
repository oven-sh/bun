import { jest, mock, test, vi } from "bun:test";
import { again } from "./again.mjs";
test("c", () => console.log("c", again()));
