import { test } from "bun:test";
import "./lays.mjs";
test("a", () => { const { read } = require("./product.cjs"); console.log("a", read()); });
