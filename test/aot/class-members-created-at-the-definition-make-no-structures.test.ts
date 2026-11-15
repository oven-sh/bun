import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfMethods = 120;
const numbers = Array.from({ length: numberOfMethods }, (_, index) => index + 1);

// The record of the class creates no member behind the computed key, so an operation defines each of them.
const classAndItsUse = `
    const hidden = Symbol("hidden");
    const state = Symbol("state");
    class Big extends EventEmitter {
      get pair() { return this[state]; }
      set pair(value) { this[state] = value; }
      [hidden]() { return 0; }
${numbers.map(number => `      method${number}(value) { return value + ${number}; }`).join("\n")}
    }
    function use(made) {
      made.pair = made[hidden]();
      let sum = made.pair;
${numbers.map(number => `      sum += made.method${number}(1);`).join("\n")}
      return sum;
    }
`;

const countStructures = `
    const structures = () => heapStats().objectTypeCounts.Structure;
    structures();
    const before = structures();
`;

const files = {
  "class.cjs": `
    "use strict";
    const EventEmitter = require("node:events");
    ${classAndItsUse}
    module.exports = { Big, use };
  `,
  // Nothing proves that a module which is required inside a function is evaluated once, so nothing proves it of its class.
  "required-late.cjs": `
    "use strict";
    const { heapStats } = require("bun:jsc");
    require("node:events");
    let loaded;
    function library() {
      return loaded || (loaded = require("./class.cjs"));
    }
    ${countStructures}
    let sum = 0;
    for (let round = 0; round < 2; round++) {
      const { Big, use } = library();
      sum += use(new Big());
    }
    console.log(sum / 2, structures() - before);
  `,
  "class.mjs": `
    import EventEmitter from "node:events";
    ${classAndItsUse}
    export { Big, use };
  `,
  // No member captures anything, so the record creates both halves of the accessor.
  "imported.mjs": `
    import { heapStats } from "bun:jsc";
    import "node:events";
    ${countStructures}
    const { Big, use } = await import("./class.mjs");
    console.log(use(new Big()), structures() - before);
  `,
};

test.each(["required-late.cjs", "imported.mjs"])(
  "the members that the operations of a class definition create are added to one Structure: %s",
  async entry => {
    using dir = tempDir("aot-class-members-created-at-the-definition", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const ran = await run([executable], String(dir));
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const [sum, structuresMade] = ran.stdout.trim().split(" ").map(Number);
    expect(sum).toBe(numbers.reduce((total, number) => total + number + 1, 0));
    expect(structuresMade).toBeLessThan(numberOfMethods);
  },
  240_000,
);
