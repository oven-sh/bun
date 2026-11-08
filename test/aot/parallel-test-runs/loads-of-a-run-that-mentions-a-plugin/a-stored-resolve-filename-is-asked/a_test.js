import { plugin } from "bun";
import { test } from "bun:test";
import Module from "node:module";
import { seen } from "./src/user.cjs";
const spare = () => require("./src/swapped.cjs");
test("a stored Module._resolveFilename beside a mention of Bun.plugin", () => {
  const original = Module._resolveFilename;
  const asked = [];
  Module._resolveFilename = function (name, ...rest) {
    asked.push(name);
    return original.call(this, name === "./old.cjs" ? "./swapped.cjs" : name, ...rest);
  };
  const said = seen();
  Module._resolveFilename = original;
  console.log("SAID", said, typeof plugin, typeof spare, "|", asked.join(" "));
});
