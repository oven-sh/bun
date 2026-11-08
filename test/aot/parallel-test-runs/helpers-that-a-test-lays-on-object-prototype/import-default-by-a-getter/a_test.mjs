import { test } from "bun:test";
Object.defineProperty(Object.prototype, "__importDefault", { get() { return function (mod) { return { default: { label: "from above" } }; }; }, configurable: true });
test("a", () => { const { read } = require("./product.cjs"); console.log("a", read()); });
