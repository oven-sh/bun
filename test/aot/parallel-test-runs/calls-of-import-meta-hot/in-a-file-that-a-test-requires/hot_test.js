import { test } from "bun:test";
test("the file loads", () => { console.log(require("./store.cjs.helper.js").loaded); });
