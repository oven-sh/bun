import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// A package of helpers in the form that works under every loader: the names of its exports are arguments of a function that stores, which one function makes,
// a second is handed and a third calls. Beside it lies the file that an `import` of such a package finds.
const files = {
  "helpers/index.js": `var extend;
(function (factory) {
  var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : {};
  if (typeof define === "function" && define.amd) {
    define("helpers", ["exports"], function (exports) { factory(createExporter(root, createExporter(exports))); });
  } else if (typeof module === "object" && typeof module.exports === "object") {
    factory(createExporter(root, createExporter(module.exports)));
  } else {
    factory(createExporter(root));
  }
  function createExporter(exports, previous) {
    if (exports !== root) Object.defineProperty(exports, "__esModule", { value: true });
    return function (id, v) { return exports[id] = previous ? previous(id, v) : v; };
  }
})(function (exporter) {
  extend = function (child, parent) {
    Object.setPrototypeOf(child, parent);
    function Link() { this.constructor = child; }
    child.prototype = (Link.prototype = parent.prototype, new Link());
  };
  exporter("extend", extend);
  exporter("other", function () {});
});
`,
  "helpers/face.mjs": `import helpers from "./index.js";
const { extend, other } = helpers;
export { extend, other };
export default helpers;
`,
};
const classes = `function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " makes a sound"; };
function Dog(name) { Animal.call(this, name); this.legs = 4; }
`;
const use = `var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
`;
const forms: Record<string, [string, string, string]> = {
  "required": ["main.cjs", `var helpers = require("./helpers/index.js");\n`, `helpers.extend(Dog, Animal);\n`],
  "imported whole": ["main.mjs", `import helpers from "./helpers/index.js";\n`, `helpers.extend(Dog, Animal);\n`],
  "imported by name out of the file beside it": [
    "main.mjs",
    `import { extend } from "./helpers/face.mjs";\n`,
    `extend(Dog, Animal);\n`,
  ],
  "imported as a namespace out of the file beside it": [
    "main.mjs",
    `import * as helpers from "./helpers/face.mjs";\n`,
    `helpers.extend(Dog, Animal);\n`,
  ],
};

for (const [form, [main, head, link]] of Object.entries(forms)) {
  test(`a helper that a call stores in the exports, ${form}`, async () => {
    using dir = tempDir("aot-helper-stored-by-a-call", { ...files, [main]: head + classes + link + use });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), main, "--outfile", "main"];
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
