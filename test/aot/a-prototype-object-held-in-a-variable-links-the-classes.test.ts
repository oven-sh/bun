import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const classes = `function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " makes a sound"; };
function Dog(name) { Animal.call(this, name); this.legs = 4; }
`;
const use = `var dog = new Dog("Rex");
console.log(dog.speak(), dog.legs, dog instanceof Animal, dog.constructor === Dog);
`;
const forms: Record<string, string> = {
  "at the top level": `var made = Object.create(Animal.prototype);\nmade.constructor = Dog;\nDog.prototype = made;\n`,
  "in a constant": `const made = Object.create(Animal.prototype);\nmade.constructor = Dog;\nDog.prototype = made;\n`,
  "in a helper": `function link(child, parent) { var made = Object.create(parent.prototype); made.constructor = child; child.prototype = made; }\nlink(Dog, Animal);\n`,
};

for (const [form, link] of Object.entries(forms)) {
  test(`a prototype object held in a variable ${form}`, async () => {
    using dir = tempDir("aot-prototype-object-in-a-variable", { "main.js": classes + link + use });
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
