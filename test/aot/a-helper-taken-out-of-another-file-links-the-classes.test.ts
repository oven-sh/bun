import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// As the compilers write it: the helper lies in a package, is its file's module.exports and its own `default`, and is called behind `(0, ..)`.
const files = {
  "link.js": `function link(child, parent) { child.prototype = Object.create(parent.prototype), child.prototype.constructor = child, Object.setPrototypeOf(child, parent); }
module.exports = link, module.exports.__esModule = true, module.exports["default"] = module.exports;
`,
  "interop.js": `function interop(it) { return it && it.__esModule ? it : { "default": it }; }
module.exports = interop, module.exports.__esModule = true, module.exports["default"] = module.exports;
`,
};
const classes = `function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " makes a sound"; };
function Dog(name) { Animal.call(this, name); this.legs = 4; }
`;
const use = `var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
`;
const forms: Record<string, [string, string]> = {
  "called behind a comma": [`var link = require("./link.js");\n`, `(0, link)(Dog, Animal);\n`],
  "read under the default that is its file's module.exports": [
    `var link = require("./link.js");\n`,
    `link["default"](Dog, Animal);\n`,
  ],
  "handed through a function that answers it or wraps it": [
    `var interop = require("./interop.js");\nvar link = interop(require("./link.js"));\n`,
    `(0, link["default"])(Dog, Animal);\n`,
  ],
  "handed through such a function of the file": [
    `var interop = (this && this.interop) || function (it) { return it && it.__esModule ? it : { "default": it }; };\nvar link = interop(require("./link.js"));\n`,
    `(0, link.default)(Dog, Animal);\n`,
  ],
};

for (const [form, [head, link]] of Object.entries(forms)) {
  test(`a helper of another file ${form}`, async () => {
    using dir = tempDir("aot-helper-of-another-file", { ...files, "main.js": head + classes + link + use });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      writesProgramInto(folder),
      "main.js",
      "--outfile",
      "main",
    ];
    built(await spawned(command, folder, env));
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
      stdout: "Rex makes a sound 4 true true\n",
      exitCode: 0,
    });

    const layouts = (await printIR(folder, {})).split("\n").filter(line => line.startsWith("layout "));
    const animal = layouts.find(line => line.includes(` kind=Instance name="Animal" `))!.split(" ")[1];
    expect(layouts.find(line => line.includes(` kind=Instance name="Dog" `))).toContain(` base=${animal} `);
  }, 120_000);
}
