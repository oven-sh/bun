import { test } from "bun:test";
test("b", () => { const { read } = require("./other.cjs"); console.log("b", read()); });
