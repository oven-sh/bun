import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("b", () => { const r = require("./x.json"); console.log("R b requires it in a realm that has not imported it:", Object.prototype.toString.call(r), Object.keys(r).join(), "default" in r); });
