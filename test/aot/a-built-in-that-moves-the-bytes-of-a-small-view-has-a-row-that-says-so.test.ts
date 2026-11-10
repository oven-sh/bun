// The compiler keeps the address of the bytes of a view over a call of a built-in whose row does not write TypedArrayStorage. A view of a few bytes keeps them in its own cell, and native code that wants an
// ArrayBuffer of them, or pins them, moves them out. built-ins-alone/small-views.ts calls, in a process of its own, every row that may be believed with a view among its operands, with a small view in each place
// that names a class of views, and sees the move by what the cell weighs. A row under which the bytes move says so.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import type { SmallViewsFound } from "./built-ins-alone/small-views";
import { builtinTableOf } from "./harness/builtin-table";
import { test } from "./supported";

function weigh(...forgotten: string[]): SmallViewsFound {
  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "built-ins-alone/small-views.ts"), builtinTableOf(bunExe()), ...forgotten],
    cwd: String(tempDir("aot-small-views", {})),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const last = stdout.toString().trimEnd().split("\n").at(-1)!;
  if (!last.startsWith("{")) throw new Error(stderr.toString().slice(-4000));
  return JSON.parse(last);
}

test("a built-in that moves the bytes of a small view has a row that says so", () => {
  const found = weigh();
  expect(found.silent).toEqual([]);
  // A row of the kind that no call holds gets a call in `routes` there, or a reason in `notCalled`.
  expect(found.notHeld).toEqual([]);
  expect(found.blind).toEqual([]);
  expect(found.saysSo).toContain("%TypedArray%.prototype.subarray this");
  expect(found.called).toBeGreaterThan(150);
}, 60_000);

test("a row that does not say so is found", () => {
  expect(weigh("Buffer.prototype.subarray").silent).toEqual(["Buffer.prototype.subarray this"]);
}, 60_000);
