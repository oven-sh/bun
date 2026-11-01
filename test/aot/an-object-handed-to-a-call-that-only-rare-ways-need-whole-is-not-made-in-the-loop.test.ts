import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// The loop stands in a function that is called once, where the inliner has least to spend.
const rounds = `
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i & 7);
  return sum;
}
console.log(bench(1000));
`;
const check = `"use strict";
function check(instance, Constructor) {
  if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}`;
const programs: Record<string, { text: string; printed: string }> = {
  "a method on the prototype": {
    text: `${check}
function A() { check(this, A); this.z = 1; }
A.prototype.base = function () { return this.z; };
function turn(i) { var v = new A(); return v.base() + i; }
${rounds}`,
    printed: "4500\n",
  },
  "an accessor on the prototype": {
    text: `${check}
function A(a) { check(this, A); this._a = a; }
Object.defineProperty(A.prototype, "a", { get: function () { return this._a; }, set: function (v) { this._a = v; }, configurable: true });
function turn(i) { var v = new A(i); v.a = v.a + 1; return v.a; }
${rounds}`,
    printed: "4500\n",
  },
};

for (const [form, { text, printed }] of Object.entries(programs)) {
  test(`a new object is handed to a small function, and beside that only ways that are seldom taken need it whole, ${form}: the function is copied in and the loop makes no object`, async () => {
    using dir = tempDir("aot-object-only-rare-ways-need-whole", { "main.js": text });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), "main.js", "--outfile", "main"],
        folder,
        env,
      ),
    );
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: printed, exitCode: 0 });

    let isLikely = false;
    const madeOrCalledOnLikelyWays = (await printIR(folder, { until: "Select", functionName: "bench" }))
      .split("\n")
      .filter(line => {
        if (/^  b\d+\(/.test(line)) isLikely = !line.includes(" frequency=");
        return isLikely && / = (NewObject|CallDirect|Call) /.test(line);
      });
    expect(madeOrCalledOnLikelyWays).toEqual([]);
  }, 120_000);
}
