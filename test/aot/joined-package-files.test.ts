// A package that joins its own files into the text of a function runs compiled code, the constructors that the text makes too.
// A text that the program changes is interpreted.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const timeout = 600_000;

const files = (read: string) => ({
  "main.cjs": `const { Leaf, Pair, print } = require("kit"); console.log(print(new Pair({ left: new Leaf({ value: "x" }), right: new Leaf({ value: "y" }) })));`,
  "node_modules/kit/package.json": `{ "name": "kit", "version": "1.0.0", "main": "tools/index.js" }`,
  "node_modules/kit/tools/index.js": `
var fs = require("fs");
exports.FILES = [require.resolve("../lib/nodes.js"), require.resolve("../lib/print.js")];
new Function("exports", function() {
  var code = exports.FILES.map(function(file) { return ${read}; });
  code.push("exports.describe = " + describe.toString());
  return code.join("\\n\\n");
}())(exports);
function describe() { return "nodes"; }`,
  "node_modules/kit/lib/nodes.js": `"use strict";
function define(type, props, base) {
  props = props ? props.split(/\\s+/) : [];
  if (base && base.PROPS) props = props.concat(base.PROPS);
  var code = ["return function ", type, "(props){"];
  props.forEach(function(prop) { code.push("this.", prop, "=props.", prop, ";"); });
  code.push("};");
  var ctor = new Function(code.join(""))();
  ctor.PROPS = props;
  return exports[type] = ctor;
}
var Leaf = define("Leaf", "value start", null);
var Pair = define("Pair", "left right", Leaf);
`,
  "node_modules/kit/lib/print.js": `
// a tree --> a string
exports.print = function print(node) {
  if (node instanceof Pair) return "(" + print(node.left) + print(node.right) + ")";
  return node.value.replace(/^x$/, "<!--").toUpperCase();
};
`,
});

async function run(read: string) {
  using dir = tempDir("aot-joined-files", files(read));
  const [executable, counts] = [join(String(dir), "program"), join(String(dir), "counts")];
  const command = [bunExe(), ...compileCommand, ...withoutDebugInformation(), "main.cjs", "--outfile", executable];
  built(await spawned(command, String(dir), bunEnv));
  const ran = await spawned([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
  const interpreted = /^(\d+)\tcounter:InterpretedFunctionCode$/m.exec(readFileSync(counts, "utf8"));
  return { stdout: ran.stdout, exitCode: ran.exitCode, isInterpreted: Number(interpreted?.[1]) > 0 };
}

describe.concurrent("compile/aot/joined package files", () => {
  test.each([
    ["are compiled", `fs.readFileSync(file, "utf8")`, "(<!--Y)\n", false],
    [
      "are interpreted where they change",
      `fs.readFileSync(file, "utf8").replace("<!--", process.argv[0] && "-->")`,
      "(-->Y)\n",
      true,
    ],
  ])(
    "%s",
    (_, read, stdout, isInterpreted) =>
      slot(async () => expect(await run(read)).toEqual({ stdout, exitCode: 0, isInterpreted })),
    timeout,
  );
});
