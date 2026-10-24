// The objects that Bun's own modules make are Node's public surface and behave as in plain Bun: a program deletes, redefines, re-parents and stores into them.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { parse } from "node:path";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
const makers: [string, () => any, string][] = [
  ["an EventEmitter", () => new EventEmitter(), "_events"],
  ["a Readable", () => new Readable({ read() {} }), "_readableState"],
  ["what path.parse returns", () => parse("/a/b.txt"), "base"],
];
for (const [how, make, name] of makers) {
  attempt(how + ", delete", () => { const o = make(); return [delete o[name], name in o].join(); });
  attempt(how + ", a getter", () => Object.defineProperty(make(), name, { get() { return 7; }, configurable: true })[name]);
  attempt(how + ", another prototype", () => Object.setPrototypeOf(make(), { marker: true }).marker);
  attempt(how + ", a store of another kind", () => { const o = make(); o[name] = 5; return o[name]; });
}
