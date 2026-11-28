import { test } from "bun:test";
import calls from "./calls.cjs";
import made from "./made.mjs";
import statements from "./statements.mjs";
test("statements", () => console.log(statements().join()));
test("calls", async () => console.log((await calls()).join()));
test("functions that createRequire() made", () => console.log(made().join()));
