import { test } from "bun:test";
const show = (name, value) => console.log(name, typeof value, typeof value === "object" ? typeof value.default : "");
test("b", () => show("require", require("./sums.wasm")));
