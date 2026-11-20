import { test } from "bun:test";
Object.prototype.__importDefault = function (mod) { return { default: { label: "from above" } }; };
test("a", () => { const { read } = require("./product.cjs"); console.log("a", read()); delete Object.prototype.__importDefault; });
