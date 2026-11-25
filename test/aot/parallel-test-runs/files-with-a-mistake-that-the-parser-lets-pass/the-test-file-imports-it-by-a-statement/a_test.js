import { test } from "bun:test";
import "./start.mjs";
import "./panel.mjs";
test("is never reached", () => console.log("the test file ran"));
