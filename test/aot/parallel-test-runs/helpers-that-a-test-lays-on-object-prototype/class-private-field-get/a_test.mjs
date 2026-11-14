import { test } from "bun:test";
Object.prototype.__classPrivateFieldGet = function () { return "from above"; };
test("a", () => { const { Holder } = require("./product.cjs"); console.log("a", new Holder().read()); });
