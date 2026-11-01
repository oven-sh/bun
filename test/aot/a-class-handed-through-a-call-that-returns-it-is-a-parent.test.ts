import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const inherits = `function inherits(child, parent) {
  child.prototype = Object.create(parent && parent.prototype, { constructor: { value: child, writable: true, configurable: true } });
  if (parent) Object.setPrototypeOf(child, parent);
}
`;
const classes = `var Animal = /*#__PURE__*/function () {
  function Animal(name) {
    this.name = name;
  }
  Animal.prototype.speak = function () { return this.name + " makes a sound"; };
  return finish(Animal, []);
}();
var Dog = /*#__PURE__*/function (_Animal) {
  function Dog(name) {
    _Animal.call(this, name);
    this.legs = 4;
  }
  inherits(Dog, _Animal);
  return finish(Dog);
}(Animal);
var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
`;
const forms: Record<string, string> = {
  "in a statement of its own": `function finish(made, members) { if (members) members.length = 0; return made; }\n`,
  "at the end of one expression": `function finish(e, r) { return r && (r.length = 0), e; }\n`,
};

for (const [form, finish] of Object.entries(forms)) {
  test(`a function that returns its parameter ${form} hands the class on`, async () => {
    using dir = tempDir("aot-class-through-a-call", { "main.js": '"use strict";\n' + finish + inherits + classes });
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
