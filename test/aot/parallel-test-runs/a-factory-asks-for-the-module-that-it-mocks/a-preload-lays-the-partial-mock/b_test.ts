import { rate, fee } from "./tax";
import { test } from "bun:test";
test("b", () => { console.log("b", rate, fee); });
