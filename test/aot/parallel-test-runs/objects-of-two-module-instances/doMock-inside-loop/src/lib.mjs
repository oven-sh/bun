import { base } from "./dep.mjs";
globalThis.loads = (globalThis.loads ?? 0) + 1;
export const load = globalThis.loads;
let calls = 0;
export let shared = base * 100 + load;
export function bump() { shared += 1000; return shared; }
export class Box {
  constructor(x) { this.x = x; }
  sum(n) { calls++; return this.x + n + shared + load * 10; }
  get size() { return this.x * 2 + shared + calls; }
  set size(v) { this.x = v + load; }
  static make(x) { return new Box(x + load); }
  static where() { return load * 7 + shared; }
  async later(n) { return n + shared; }
  *each(n) { for (let i = 0; i < n; i++) yield i + shared; }
}
export class Deep extends Box { sum(n) { return super.sum(n) + load; } get size() { return super.size + 1; } }
export const tools = { add(n) { return n + shared; }, sub: n => n - shared, get now() { return shared; } };
export const arrow = n => n + shared * 2;
export function make(x) { return new Box(x); }
export function makeDeep(x) { return new Deep(x); }
