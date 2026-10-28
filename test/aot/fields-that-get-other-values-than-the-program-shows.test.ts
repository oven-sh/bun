// Objects of eight makers whose fields the program shows small integers, and which get whatever a text holds that the build cannot read: large numbers, fractions, -0, texts, null, nothing, objects.
// It happens to many objects one after the other, in every order of the fields, while accessors and read-only properties come and go above them, while they get other prototypes, become prototypes,
// are frozen, and while collections run. One program holds all of it, each case with declarations of its own. It runs under plain Bun and as an --aot executable, with its types and without, and prints the same.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const makers: Record<string, (n: number) => string> = {
  storedAfterwards: n =>
    `class P${n} { constructor(id) { this.id = id; this.a = id; this.b = id + 1; this.c = id + 2; } }
const make${n} = (id, x, y, z) => { const p = new P${n}(id); p.a = x; p.b = y; p.c = z; return p; };
const proto${n} = P${n}.prototype;`,
  constructed: n =>
    `class P${n} { constructor(id, x, y, z) { this.id = id; this.a = x; this.b = y; this.c = z; } }
const make${n} = (id, x, y, z) => new P${n}(id, x, y, z);
const proto${n} = P${n}.prototype;`,
  reversed: n =>
    `class P${n} { constructor(id, x, y, z) { this.id = id; this.c = z; this.b = y; this.a = x; } }
const make${n} = (id, x, y, z) => new P${n}(id, x, y, z);
const proto${n} = P${n}.prototype;`,
  literal: n =>
    `const proto${n} = null;
const make${n} = (id, x, y, z) => ({ id, a: x, b: y, c: z });`,
  heir: n =>
    `class Base${n} { constructor(id, x) { this.id = id; this.a = x; } }
class P${n} extends Base${n} { constructor(id, x, y, z) { super(id, x); this.b = y; this.c = z; } }
const make${n} = (id, x, y, z) => new P${n}(id, x, y, z);
const proto${n} = Base${n}.prototype;`,
  plainFunction: n =>
    `function P${n}(id, x, y, z) { this.id = id; this.a = x; this.b = y; this.c = z; }
const make${n} = (id, x, y, z) => new P${n}(id, x, y, z);
const proto${n} = P${n}.prototype;`,
  withOtherPropertiesFirst: n =>
    `class P${n} { constructor(id) { this.id = id; this.a = id; this.b = id + 1; this.c = id + 2; } }
const make${n} = (id, x, y, z) => { const p = new P${n}(id); p.early = id; if (id & 2) p.second = id; p.a = x; p.b = y; p.c = z; return p; };
const proto${n} = P${n}.prototype;`,
  inTwoOrders: n =>
    `class P${n} { constructor(id) { this.id = id; } }
const make${n} = (id, x, y, z) => { const p = new P${n}(id); if (id & 1) { p.a = x; p.b = y; p.c = z; } else { p.c = z; p.a = x; p.b = y; } return p; };
const proto${n} = P${n}.prototype;`,
};
const events: Record<string, (n: number) => string> = {
  none: () => ``,
  setterAbove: n =>
    `if (round === 500) Object.defineProperty(proto${n}, "b", { set(v) { log.push("set b " + show(v)); }, get() { return "from above"; }, configurable: true }); if (round === 1000) delete proto${n}.b;`,
  readOnlyAbove: n =>
    `if (round === 500) Object.defineProperty(proto${n}, "a", { value: "fixed", writable: false, configurable: true }); if (round === 1000) delete proto${n}.a;`,
  collections: () => `if (round % 97 === 0) Bun.gc(true);`,
  otherPrototype: () =>
    `if (round % 50 === 7) Object.setPrototypeOf(pool[next(pool.length)], round % 100 === 7 ? null : { b: "other" });`,
  becomesPrototype: () => `if (round % 40 === 3) heirs.push(Object.create(pool[next(pool.length)]));`,
  integrity: () =>
    `if (round % 30 === 5) [Object.freeze, Object.seal, Object.preventExtensions][next(3)](pool[next(pool.length)]);`,
};
const given = {
  nothingFits: `[{"v":4294967296},{"v":0.5},{"v":-0},{"v":"text"},{"v":null},{},{"v":{"n":1}},{"v":2147483648}]`,
  numbers: `[{"v":4294967303},{"v":7.5},{"v":-0},{"v":1e300},{"v":-2147483649},{"v":2147483648},{"v":0.25},{"v":-4294967296.5}]`,
  halfFits: `[{"v":1},{"v":0.5},{"v":2},{"v":4294967296},{"v":3},{"v":"t"},{"v":null},{"v":4}]`,
  mostFits: `[{"v":1},{"v":2},{"v":3},{"v":4},{"v":5},{"v":6},{"v":7},{"v":1.5}]`,
};

let program = `// @ts-nocheck
"use strict";
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
let seed = 0;
const next = n => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
const describe = o => { const inLoop = []; for (const key in o) inLoop.push(key); return Object.keys(o).join() + "|" + inLoop.join() + "|" + JSON.stringify(o) + "|" + show(o.a) + "," + show(o.b) + "," + show(o.c) + "|" + ("a" in o) + Object.hasOwn(o, "b") + "|" + JSON.stringify({ ...o }) + "|" + JSON.stringify(Object.getOwnPropertyDescriptor(o, "c") ?? null) + Object.isFrozen(o); };
const shown = { v: 1 };
`;
let n = 0;
for (const [maker, declarations] of Object.entries(makers))
  for (const [event, happens] of Object.entries(events))
    for (const [kind, text] of Object.entries(given)) {
      // There is nothing above a literal but Object.prototype.
      if (maker === "literal" && (event === "setterAbove" || event === "readOnlyAbove")) continue;
      n++;
      program += `${declarations(n)}
function run${n}() {
  seed = ${1000 + n};
  const rows = JSON.parse(Buffer.from("${Buffer.from(text).toString("base64")}", "base64").toString());
  if (rows.length !== 8) rows.push(shown);
  const pool = []; const heirs = []; const log = [];
  let checksum = 0; let thrown = 0;
  const note = text => { for (let i = 0; i < text.length; i++) checksum = (Math.imul(checksum, 31) + text.charCodeAt(i)) | 0; };
  const pick = () => rows[next(rows.length)].v;
  for (let round = 0; round < 1500; round++) {
    try { pool[round & 15] = make${n}(round, pick(), pick(), pick()); } catch (error) { thrown++; note(String(error && error.constructor && error.constructor.name)); }
    ${happens(n)}
    for (let step = next(4); step > 0; step--) {
      const o = pool[next(pool.length)];
      const what = next(12);
      try {
        if (what < 3) o.a = pick();
        else if (what < 6) o.b = pick();
        else if (what < 8) o.c = pick();
        else if (what === 8) delete o[["a", "b", "c"][next(3)]];
        else if (what === 9) Object.defineProperty(o, ["a", "b", "c"][next(3)], { value: pick(), writable: true, enumerable: true, configurable: true });
        else if (what === 10) o["x" + next(3)] = pick();
        else o.a = (typeof o.a === "number" ? o.a : 0) + 1;
      } catch (error) { thrown++; note(String(error && error.constructor && error.constructor.name)); }
    }
    note(describe(pool[next(pool.length)]));
    if (heirs.length) note(describe(heirs[next(heirs.length)]));
  }
  console.log(${JSON.stringify(`${maker} ${event} ${kind}`)}, checksum, thrown, log.length, log.slice(0, 3).join(";"), describe(pool[3]), describe(pool[12]));
}
run${n}();
`;
    }

describe.skipIf(!!unsupported)("compile/aot/fields-that-get-other-values-than-the-program-shows", () => {
  const folder = String(tempDir("aot-fields-that-get-other-values", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "program.ts");
  writeFileSync(path, program);
  const plain = spawned([bunExe(), "run", path], folder, bunEnv);

  test.concurrent.each([
    ["with its types", []],
    ["without its types", ["--aot-erase-types"]],
  ])("%s", (_, flags) =>
    slot(async () => {
      const executable = join(folder, "program" + flags.join(""));
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, path, "--outfile", executable],
          folder,
          bunEnv,
        ),
      );
      const compiled = await spawned([executable], folder, bunEnv);
      const reference = await plain;
      expect({ signal: reference.signal, exitCode: reference.exitCode, stderr: reference.stderr }).toEqual({
        signal: null,
        exitCode: 0,
        stderr: "",
      });
      expect({ signal: compiled.signal, exitCode: compiled.exitCode, stderr: compiled.stderr }).toEqual({
        signal: null,
        exitCode: 0,
        stderr: "",
      });
      expect(compiled.stdout.split("\n")).toEqual(reference.stdout.split("\n"));
    }),
  );
});
