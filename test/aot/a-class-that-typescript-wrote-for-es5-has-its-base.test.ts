import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const helper = `var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
`;
const classes = `var Animal = /** @class */ (function () {
    function Animal(name) {
        this.name = name;
    }
    Animal.prototype.speak = function () { return this.name + " makes a sound"; };
    return Animal;
}());
var Dog = /** @class */ (function (_super) {
    __extends(Dog, _super);
    function Dog(name, legs) {
        var _this = _super.call(this, name) || this;
        _this.legs = legs;
        return _this;
    }
    Dog.prototype.count = function () { return this.legs; };
    return Dog;
}(Animal));
var dog = new Dog("Rex", 4);
console.log(dog.speak(), dog.count(), dog instanceof Animal, Object.keys(Dog.prototype).join(), Object.getPrototypeOf(Dog) === Animal);
`;
const prints = "Rex makes a sound 4 true constructor,count true\n";

const files: Record<string, string> = {
  "main.js": helper + classes,
  "main.cjs": `"use strict";\n` + helper + `Object.defineProperty(exports, "__esModule", { value: true });\n` + classes,
  "main.mjs": helper + classes + "export {};\n",
};

for (const [name, text] of Object.entries(files)) {
  test(`the helper behind \`(this && this.__extends) ||\` links the classes of ${name}`, async () => {
    using dir = tempDir("aot-es5-class-has-its-base", { [name]: text });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), name, "--outfile", "main"];
    built(await spawned(command, folder, env));
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: prints, exitCode: 0 });

    const layouts = (await printIR(folder, {})).split("\n").filter(line => line.startsWith("layout "));
    const animal = layouts.find(line => line.includes(` kind=Instance name="Animal" `))!.split(" ")[1];
    expect(layouts.find(line => line.includes(` kind=Instance name="Dog" `))).toContain(` base=${animal} `);
  }, 120_000);
}
