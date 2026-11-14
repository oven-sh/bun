import { test } from "bun:test";
import { flag } from "./dep";
test("a", () => { console.log("a", flag); });
