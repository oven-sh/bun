// The damage is no part of anything that the caller calls. It waits in the queue of microtasks, and the callee asks the run time to drain that queue. So it runs while both callers are on the stack,
// called by nobody whom a summary of effects could name.
import { drainMicrotasks } from "bun:jsc";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function callee(round: number): number {
  drainMicrotasks();
  return round & 3;
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round);
  return before + " " + got + " " + (p.x + 1) + "," + typeof p.x + "," + p.y;
}

function outer(round: number): string {
  const p = new Point(round, 1);
  const before = p.x - p.y;
  if (round % 100 === 97) void Promise.resolve().then(() => void delete (p as any).x);
  if (round % 100 === 98) void Promise.resolve().then(() => void ((p as any).x = "late"));
  if (round % 100 === 99) queueMicrotask(() => void Object.defineProperty(p, "x", { get: () => -7, configurable: true }));
  const inner = holder(p, round);
  return before + " [" + inner + "] " + (p.x + 1) + "," + typeof p.x;
}

for (let round = 0; round < 300; round++) {
  const line = outer(round);
  if (round % 100 >= 96 || round === 0) console.log(round + ": " + line);
}
