import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// How compilers link the classes that they turn into functions, and what they emit for `super(..)` there.
const text = `"use strict";
function A() { this.z = 1; }
A.prototype.base = function () { return this.z; };
function B(a) { var self = Reflect.construct(Object.getPrototypeOf(B), [], Object.getPrototypeOf(this).constructor); self.a = a; return self; }
B.prototype = Object.create(A.prototype, { constructor: { value: B, writable: true, configurable: true } });
Object.setPrototypeOf(B, A);
function turn(i) { var v = new B(i); return v.a + v.base(); }
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i & 7);
  return sum;
}
console.log(bench(1000));
`;

test("`constructor` comes out of the map of descriptors that Object.create takes: what Object.prototype holds under that name is no descriptor, so the function stays in the program's hands and is constructed for directly", async () => {
  using dir = tempDir("aot-constructor-out-of-a-map-of-descriptors", { "main.js": text });
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
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "4500\n", exitCode: 0 });

  for (const functionName of ["turn", "B"]) {
    let isLikely = false;
    const leftOnLikelyWays = (await printIR(folder, { until: "Select", functionName })).split("\n").filter(line => {
      if (/^  b\d+\(/.test(line)) isLikely = !line.includes(" frequency=");
      return isLikely && /ReflectConstruct| = (Construct|ConstructList) /.test(line);
    });
    expect({ functionName, leftOnLikelyWays }).toEqual({ functionName, leftOnLikelyWays: [] });
  }
}, 120_000);
