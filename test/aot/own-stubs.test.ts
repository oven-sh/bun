// The shared code that reads a property by name, or calls a method by name, takes the name as an argument. A name that a program uses often gets that code once more, for itself alone.
// "Often" is a limit, MinUsesForOwnStub, and so high that no small program meets it: here it is lowered, so that a small program runs that code.
// Whatever the limit is, the program prints what plain Bun prints.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const files = {
  "program.js": `
    const hide = value => JSON.parse("0", () => value);
    const lines = [];
    function attempt(what, work) {
      try {
        lines.push(what + " " + String(work()));
      } catch (error) {
        lines.push(what + " " + error.constructor.name);
      }
    }
    class Base {
      get viaGetter() { return "getter"; }
      set viaSetter(value) { this.seen = value; }
      inherited() { return "inherited"; }
    }
    class Heir extends Base {
      own = "own";
      method() { return "method " + this.own; }
    }
    const receivers = {
      literal: { own: "literal", method() { return "m"; } },
      heir: new Heir(),
      array: [1, 2],
      text: "text",
      number: 5,
      function: function named() {},
      frozen: Object.freeze({ own: "frozen" }),
      bare: Object.create(null),
      proxy: new Proxy({ own: "target" }, { get: (target, key) => "trap " + String(key), set: () => true }),
      null: null,
      undefined: undefined,
    };
    for (const [name, value] of Object.entries(receivers)) {
      const receiver = hide(value);
      attempt(name + " reads its own", () => receiver.own);
      attempt(name + " reads length", () => receiver.length);
      attempt(name + " reads a getter", () => receiver.viaGetter);
      attempt(name + " reads what is not there", () => receiver.absent);
      attempt(name + " calls its own", () => receiver.method());
      attempt(name + " calls what it inherits", () => receiver.inherited());
      attempt(name + " calls toString", () => typeof receiver.toString());
      attempt(name + " stores its own", () => { "use strict"; receiver.own = "stored"; return receiver.own; });
      attempt(name + " stores a new one", () => { "use strict"; receiver.added = 1; return receiver.added; });
      attempt(name + " stores through a setter", () => { "use strict"; receiver.viaSetter = 7; return receiver.seen; });
    }
    console.log(lines.join("\\n"));
  `,
};

/** The shared code of the executable that was made for one name: rows \`T\` of the map, \`GetById#12\`. */
const madeForOneName = (map: string) =>
  readFileSync(map, "latin1")
    .split("\n")
    .map(row => row.split("\t"))
    .filter(columns => columns[0] === "T" && /ById[^#]*#\d+/.test(columns[2] ?? "")).length;

test(
  "a small program runs the code that is made for one name",
  () =>
    slot(async () => {
      using dir = tempDir("aot-own-stubs", files);
      const folder = String(dir);
      const printedBy = async (cmd: string[], env = bunEnv) => {
        const ended = await spawned(cmd, folder, env);
        built(ended);
        return ended.stdout;
      };
      const plain = await printedBy([bunExe(), "program.js"]);
      expect(plain.split("\n").length).toBeGreaterThan(100);
      const made: Record<string, boolean> = {};
      for (const limit of ["", "2", "1", "0"]) {
        const [map, executable] = [
          join(folder, `map${limit}`),
          join(folder, `program${limit}${isWindows ? ".exe" : ""}`),
        ];
        const flags = limit ? [`--aot-limit=MinUsesForOwnStub:${limit}`] : [];
        await printedBy([bunExe(), ...compileCommand, ...flags, "program.js", "--outfile", executable], { ...bunEnv, BUN_JSC_aotMapFilePath: map }); // prettier-ignore
        expect({ limit, stdout: await printedBy([executable]) }).toEqual({ limit, stdout: plain });
        made[limit || "as it is"] = madeForOneName(map) > 0;
      }
      // A limit that nobody reads any more would lower nothing.
      expect(made).toEqual({ "as it is": false, "2": true, "1": true, "0": true });
    }),
  300_000,
);
