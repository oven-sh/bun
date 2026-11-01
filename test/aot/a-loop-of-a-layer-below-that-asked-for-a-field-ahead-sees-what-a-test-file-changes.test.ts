import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `sum += object.total()` in a loop of a package or of src, `object` an instance of a class below Array, Map or Error: `this.count` is asked for once, ahead of the loop.
// A test file, which the layers below were built without, hands in a value whose conversion, or a function whose call, changes in the middle of the loop what that read finds.
const files: Record<string, string> = {
  "a.test.js": `import { test } from "bun:test";
import * as below from "made";
import * as beside from "./src/loops.js";
let calls = 0;
let target;
const changes = {
  store() { target.count = ++calls; },
  getter() { Object.defineProperty(target, "count", { get() { return ++calls; }, configurable: true }); },
  removed() { delete target.count; },
  removedAndAccessorAbove() { delete target.count; Object.defineProperty(Object.getPrototypeOf(target), "count", { get() { return ++calls; }, configurable: true }); },
  setterAboveThenStore() { delete target.count; let kept = 0; Object.defineProperty(Object.getPrototypeOf(target), "count", { get() { return kept; }, set(value) { kept = value + 1; }, configurable: true }); target.count = 20; },
  prototypeOfInstance() { const total = target.total; delete target.count; Object.setPrototypeOf(target, { count: 7, total }); },
  prototypeOfClass() { delete target.count; Object.setPrototypeOf(Object.getPrototypeOf(target), { count: 8 }); },
  methodReplaced() { Object.getPrototypeOf(target).total = function () { return 5; }; },
  ownMethod() { target.total = function () { return 6; }; },
  frozen() { Object.freeze(target); },
  sealedAndStored() { Object.seal(target); target.count = 9; },
  removedAndMadeAgainAsAccessor() { delete target.count; Object.defineProperty(target, "count", { get() { return ++calls + 2; }, configurable: true }); },
};
const totals = new Map([below.List, below.Table, below.Failure, beside.Longer].map(made => [made, made.prototype.total]));
const above = new Map([[below.List, Array], [below.Table, Map], [below.Failure, Error], [beside.Longer, below.List]]);
function putBack() {
  for (const [made, total] of totals) {
    delete made.prototype.count;
    if (made === beside.Longer) delete made.prototype.total;
    else made.prototype.total = total;
    Object.setPrototypeOf(made.prototype, above.get(made).prototype);
  }
  calls = 0;
}
for (const [where, loops] of [["below", below], ["beside", beside]]) {
  for (const made of [below.List, below.Table, below.Failure, beside.Longer]) {
    for (const [name, change] of Object.entries(changes)) {
      if (made === beside.Longer && name === "prototypeOfClass") continue;
      test(\`\${where} \${made.name} \${name}\`, () => {
        const said = [];
        for (const loop of ["added", "compared", "called"]) {
          putBack();
          const object = new made();
          target = object;
          const odd = loop === "called" ? change : { valueOf() { change(); return 1; } };
          const values = [];
          for (let i = 0; i < 64; i++) values.push(i === 40 ? odd : loop === "called" ? undefined : 1);
          said.push(loops[loop](object, values, 1000), calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value));
        }
        putBack();
        said.push(loops.quiet(new made(), 1000));
        console.log("SAID", where, made.name, name, said.join(" "));
      });
    }
  }
}
`,
  "b.test.js": `import { test } from "bun:test";
import * as below from "made";
import * as beside from "./src/loops.js";
let calls = 0;
let target;
const changes = {
  store() { target.count = ++calls; },
  getter() { Object.defineProperty(target, "count", { get() { return ++calls; }, configurable: true }); },
  removed() { delete target.count; },
  removedAndAccessorAbove() { delete target.count; Object.defineProperty(Object.getPrototypeOf(target), "count", { get() { return ++calls; }, configurable: true }); },
  setterAboveThenStore() { delete target.count; let kept = 0; Object.defineProperty(Object.getPrototypeOf(target), "count", { get() { return kept; }, set(value) { kept = value + 1; }, configurable: true }); target.count = 20; },
  prototypeOfInstance() { const total = target.total; delete target.count; Object.setPrototypeOf(target, { count: 7, total }); },
  prototypeOfClass() { delete target.count; Object.setPrototypeOf(Object.getPrototypeOf(target), { count: 8 }); },
  methodReplaced() { Object.getPrototypeOf(target).total = function () { return 5; }; },
  ownMethod() { target.total = function () { return 6; }; },
  frozen() { Object.freeze(target); },
  sealedAndStored() { Object.seal(target); target.count = 9; },
  removedAndMadeAgainAsAccessor() { delete target.count; Object.defineProperty(target, "count", { get() { return ++calls + 2; }, configurable: true }); },
};
const totals = new Map([below.List, below.Table, below.Failure, beside.Longer].map(made => [made, made.prototype.total]));
const above = new Map([[below.List, Array], [below.Table, Map], [below.Failure, Error], [beside.Longer, below.List]]);
function putBack() {
  for (const [made, total] of totals) {
    delete made.prototype.count;
    if (made === beside.Longer) delete made.prototype.total;
    else made.prototype.total = total;
    Object.setPrototypeOf(made.prototype, above.get(made).prototype);
  }
  calls = 0;
}
for (const [where, loops] of [["below", below], ["beside", beside]]) {
  for (const made of [below.List, below.Table, below.Failure, beside.Longer]) {
    for (const [name, change] of Object.entries(changes)) {
      if (made === beside.Longer && name === "prototypeOfClass") continue;
      test(\`\${where} \${made.name} \${name}\`, () => {
        const said = [];
        for (const loop of ["added", "compared", "called"]) {
          putBack();
          const object = new made();
          target = object;
          const odd = loop === "called" ? change : { valueOf() { change(); return 1; } };
          const values = [];
          for (let i = 0; i < 64; i++) values.push(i === 40 ? odd : loop === "called" ? undefined : 1);
          said.push(loops[loop](object, values, 1000), calls, String(Object.getOwnPropertyDescriptor(object, "count")?.value));
        }
        putBack();
        said.push(loops.quiet(new made(), 1000));
        console.log("SAID", where, made.name, name, said.join(" "));
      });
    }
  }
}
`,
  "node_modules/made/index.js": `export class List extends Array {
  count = 1;
  total() {
    return this.count;
  }
}
export class Table extends Map {
  count = 1;
  total() {
    return this.count;
  }
}
export class Failure extends Error {
  count = 1;
  total() {
    return this.count;
  }
}
export function added(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    sum += values[i & 63];
  }
  return sum;
}
export function compared(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    if (values[i & 63] > 5) sum++;
  }
  return sum;
}
export function called(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    values[i & 63]?.();
  }
  return sum;
}
export function quiet(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += object.total();
  return sum;
}
export const warmed = added(new List(), [1], 100) + compared(new Table(), [1], 100) + called(new Failure("lost"), [], 100) + quiet(new List(), 100);
`,
  "node_modules/made/package.json": `{"name":"made","type":"module","main":"index.js"}
`,
  "src/loops.js": `import { List, Table, Failure } from "made";
export class Longer extends List {
  more = 2;
}
export function added(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    sum += values[i & 63];
  }
  return sum;
}
export function compared(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    if (values[i & 63] > 5) sum++;
  }
  return sum;
}
export function called(object, values, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    values[i & 63]?.();
  }
  return sum;
}
export function quiet(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += object.total();
  return sum;
}
export const warmed = added(new List(), [1], 100) + compared(new Table(), [1], 100) + called(new Failure("lost"), [], 100) + quiet(new Longer(), 100);
`,
  "tsconfig.json": `{}
`,
};

test("each turn reads what plain Bun reads, as one image and in layers", async () => {
  using dir = tempDir("aot-a-loop-of-a-layer-below-asked-ahead", files);
  const directory = String(dir);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags, "--isolate", "--parallel=1", "."], directory, env);
    return {
      lines: ran.stdout
        .split("\n")
        .filter(line => line.startsWith("SAID"))
        .sort(),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 188 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(188);
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:1,TestRunPartFiles:1")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
