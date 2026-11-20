import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

// A build stores the values of a literal that Object.assign() is given. What the stores throw has the frame of the built-in.
// Under `bun run` the frame is missing once DFG has compiled the loop around the call, so no loop here runs long enough for that.
const env = { ...bunEnv, NO_COLOR: "1" };

const source = `
const id = x => x;
const stackOf = run => {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return error?.stack ?? String(error);
  }
};
class Point {
  constructor(x) {
    Object.assign(this, { x, y: 2 });
  }
}
class Sealed {
  constructor() {
    Object.freeze(this);
    Object.assign(this, { x: 1 });
  }
}
class WithSetter {
  set a(value) {
    throw new RangeError("set " + value);
  }
  get b() {
    return 1;
  }
}
class Filled extends WithSetter {
  fill(value) {
    return Object.assign(this, { c: 1, a: value });
  }
  fillFirst(value) {
    const filled = Object.assign(this, { c: 1, a: value });
    return filled;
  }
}
const frozen = () => id(Object.freeze({ a: 1 }));
const trapped = () => new Proxy({}, { set() { throw new RangeError("trap"); } });
const refusing = () => new Proxy({}, { set: () => false });
const cases = {
  "null, tail": () => Object.assign(id(null), { a: 2 }),
  "null": () => { const made = Object.assign(id(null), { a: 2 }); return made; },
  "undefined, tail": () => Object.assign(id(undefined), { a: 2, b: 3 }),
  "undefined": () => { Object.assign(id(undefined), { a: 2, b: 3 }); },
  "frozen, tail": () => Object.assign(frozen(), { a: 2 }),
  "frozen": () => { const made = Object.assign(frozen(), { a: 2 }); return made; },
  "frozen, new name, tail": () => Object.assign(frozen(), { b: 2 }),
  "frozen, new name": () => { Object.assign(frozen(), { b: 2 }); },
  "not extensible, second name": () => { Object.assign(id(Object.preventExtensions({ a: 1 })), { a: 2, b: 3 }); },
  "read-only, tail": () => Object.assign(id(Object.defineProperty({}, "a", { value: 1 })), { a: 2 }),
  "read-only above": () => { Object.assign(id(Object.create(frozen())), { a: 2 }); },
  "setter, tail": () => Object.assign(id(new WithSetter()), { a: 2 }),
  "setter": () => { const made = Object.assign(id(new WithSetter()), { a: 2 }); return made; },
  "setter, known class, tail": () => Object.assign(new WithSetter(), { a: 2 }),
  "setter, known class": () => { Object.assign(new WithSetter(), { a: 2 }); },
  "setter, this, tail": () => new Filled().fill(1),
  "setter, this": () => new Filled().fillFirst(1),
  "getter alone, tail": () => Object.assign(id(new WithSetter()), { b: 2 }),
  "getter alone": () => { Object.assign(new WithSetter(), { b: 2 }); },
  "accessor of a literal": () => { const o = { set a(v) { throw new RangeError("literal " + v); } }; Object.assign(o, { a: 2 }); },
  "accessor of a literal, tail": () => { const o = { set a(v) { throw new RangeError("literal " + v); } }; return Object.assign(o, { a: 2 }); },
  "frozen variable": () => { const o = { a: 1 }; Object.freeze(o); Object.assign(o, { a: 2 }); },
  "frozen variable, tail": () => { const o = { a: 1 }; Object.freeze(o); return Object.assign(o, { a: 2 }); },
  "trap, tail": () => Object.assign(trapped(), { a: 2 }),
  "trap": () => { Object.assign(trapped(), { a: 2 }); },
  "refusing trap, tail": () => Object.assign(refusing(), { a: 2 }),
  "refusing trap": () => { Object.assign(refusing(), { a: 2 }); },
  "two sources": () => { Object.assign(frozen(), { a: 2 }, id({ b: 3 })); },
  "two sources, tail": () => Object.assign(frozen(), { a: 2 }, id({ b: 3 })),
  "second source": () => { Object.assign(frozen(), id({}), { a: 2 }); },
  "second source, tail": () => Object.assign(frozen(), id({}), { a: 2 }),
  "getter of a source": () => { Object.assign(id({}), { a: 1 }, { get b() { throw new RangeError("get"); } }); },
  "in a loop": () => { for (let i = 0; i < 100; i++) Object.assign(i < 99 ? { a: 0 } : frozen(), { a: i }); },
  "in a loop, known class": () => { const made = new WithSetter(); for (let i = 0; i < 100; i++) Object.assign(i < 99 ? { a: 0 } : made, { a: i }); },
  "constructor": () => { for (let i = 0; i < 100; i++) new Point(i); new Sealed(); },
  "constructor, tail": () => new Sealed(),
  "nested": () => { Object.assign(id({}), { a: Object.assign(frozen(), { a: 2 }) }); },
  "taken": () => { const o = id({ a: 1 }); if (Object.assign(o, { a: 2, b: 3 }) !== o || o.b !== 3) throw new Error("wrong"); },
};
for (const name of Object.keys(cases)) console.log(name + ": " + stackOf(cases[name]));
`;

test.skipIf(!!unsupported)("what Object.assign() of a literal throws has the frames that it has under bun run", () =>
  slot(async () => {
    const files = { "strict.mjs": source, "sloppy.cjs": source, "typed.ts": `// @ts-nocheck\n${source}export {};\n` };
    using dir = tempDir("aot-assigned-literals", files);
    const folder = String(dir);
    const linesOf = (stdout: string) =>
      stdout
        .replaceAll(folder.replaceAll("\\", "/") + "/", "./")
        .replaceAll(folder + "\\", "./")
        .split("\n");
    for (const file of Object.keys(files)) {
      const build = [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        ...withoutDebugInformation,
        `./${file}`,
        "--outfile",
        "built",
      ];
      const built = await spawned(build, folder, env);
      expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const plain = await spawned([bunExe(), "run", "--no-install", `./${file}`], folder, env);
      const compiled = await spawned([join(folder, isWindows ? "built.exe" : "built")], folder, env);
      expect(linesOf(compiled.stdout)).toEqual(linesOf(plain.stdout));
      expect(compiled).toMatchObject({ stderr: plain.stderr, exitCode: plain.exitCode });
    }
  }),
);
