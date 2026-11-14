import { base } from "./dep.mjs";
globalThis.loads = (globalThis.loads ?? 0) + 1;
export const load = globalThis.loads;
let calls = 0;
let shared = base * 100 + load;
export function bump() { shared += 1000; return shared; }
export class Box {
  constructor(x) { this.x = x; }
  sum(n) { calls++; return this.x + n + shared + load * 10; }
  plus(n) { return this.x + n + load; }
  get size() { return this.x * 2 + shared + calls; }
}
export class Deep extends Box { sum(n) { return super.sum(n) + load; } plus(n) { return super.plus(n) + shared; } }
export function make(x) { return new Box(x); }
export function makeDeep(x) { return new Deep(x); }
