import { mock, test, vi, jest } from "bun:test";
import { seen } from "./user.mjs";
test("a", () => console.log("SAID a", seen()));
