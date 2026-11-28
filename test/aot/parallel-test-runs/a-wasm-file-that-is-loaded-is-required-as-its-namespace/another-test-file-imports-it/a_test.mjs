import { test } from "bun:test";
import place from "./sums.wasm";
const show = (name, value) => console.log(name, typeof value, typeof value === "object" ? typeof value.default : "");
test("a", () => show("import", place));
