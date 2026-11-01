import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const helper = `function (ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, { constructor: { value: ctor, enumerable: false, writable: true, configurable: true } });
}`;
const classes = `function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " makes a sound"; };
function Dog(name) { Animal.call(this, name); this.legs = 4; }
`;
const use = `var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
`;
const forms: Record<string, Record<string, string>> = {
  "in the same file": {
    "main.cjs": `var util = {};\nutil.inherits = ${helper};\n${classes}util.inherits(Dog, Animal);\n${use}`,
  },
  "that another file exports": {
    "main.cjs": `var util = require("./util.cjs");\n${classes}util.inherits(Dog, Animal);\n${use}`,
    "util.cjs": `var util = {};\nutil.inherits = ${helper};\nmodule.exports = util;\n`,
  },
  "that is the exports of another file from the start": {
    "main.cjs": `var util = require("./util.cjs");\n${classes}util.inherits(Dog, Animal);\n${use}`,
    "util.cjs": `var util = (module.exports = {});\nutil.inherits = ${helper};\n`,
  },
};

for (const [form, files] of Object.entries(forms)) {
  test(`a helper stored on an object ${form}`, async () => {
    using dir = tempDir("aot-helper-stored-on-an-object", files);
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      writesProgramInto(folder),
      "main.cjs",
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
