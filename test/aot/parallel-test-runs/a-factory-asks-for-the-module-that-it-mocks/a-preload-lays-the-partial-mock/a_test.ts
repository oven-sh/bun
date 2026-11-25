import { rate, fee } from "./tax";
import { test } from "bun:test";
test("a", () => { console.log("a", rate, fee); });
