import { jest, mock, test, vi } from "bun:test";
import { fresh } from "./fresh.mjs";
test("b", () => console.log("b", fresh()));
