import { test } from "bun:test";
import { readAll } from "./shapes.mjs";
test("the second file", async () => { await readAll(line => console.log("b:", line)); });
