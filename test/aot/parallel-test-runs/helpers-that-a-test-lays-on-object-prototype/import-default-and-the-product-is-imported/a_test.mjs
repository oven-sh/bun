import { test } from "bun:test";
Object.prototype.__importDefault = function (mod) { return { default: { label: "from above" } }; };
test("a", async () => { const product = await import("./product.cjs"); console.log("a", product.read()); });
