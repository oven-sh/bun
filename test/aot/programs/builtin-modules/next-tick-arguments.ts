// process.nextTick(callback, ...arguments): what a callback is given: how many arguments, which, `undefined` written out, holes of a spread; ticks queued by ticks; more ticks waiting than ever before; arguments are let go once the tick has run; async hooks and AsyncLocalStorage; a callback that throws.
import { AsyncLocalStorage, createHook } from "node:async_hooks";

const lines: string[] = [];
const show = (value: unknown): string => (value === undefined ? "undefined" : typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function " + value.name : (JSON.stringify(value) ?? String(value)));
function seen(this: unknown, ...all: unknown[]) {
  lines.push("this " + show(this) + ", " + all.length + " given: " + all.map(show).join(" "));
}
function counted() {
  lines.push("arguments.length " + arguments.length + ": " + Array.prototype.map.call(arguments, show).join(" "));
}
function withDefaults(a = "a by default", b = "b by default", c = "c by default") {
  lines.push("defaults: " + [a, b, c].join(", ") + " of " + arguments.length);
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

for (let count = 0; count <= 9; count++) {
  const given = Array.from({ length: count }, (_, index) => "v" + index);
  process.nextTick(seen, ...given);
  process.nextTick(counted, ...given);
}
process.nextTick(seen);
process.nextTick(seen, undefined);
process.nextTick(seen, undefined, undefined);
process.nextTick(seen, undefined, undefined, undefined);
process.nextTick(seen, undefined, undefined, undefined, undefined);
process.nextTick(seen, undefined, undefined, undefined, undefined, undefined);
process.nextTick(counted, undefined);
process.nextTick(counted, 1, undefined);
process.nextTick(counted, null, 0, "", false);
process.nextTick(withDefaults);
process.nextTick(withDefaults, undefined, "b");
process.nextTick(withDefaults, "a", undefined, undefined, "d");
process.nextTick(seen, [1, 2], { a: 1 }, Symbol.iterator, seen);
process.nextTick(seen, ...[, 1, , 2]);
process.nextTick(seen, [1, 2, 3, 4, 5, 6]);
process.nextTick.call(null, seen, "called with null");
process.nextTick.apply({ other: true }, [seen, "applied", 2, 3, 4, 5, 6]);
Reflect.apply(process.nextTick, undefined, [counted, "reflected", 2]);
const { nextTick } = process;
nextTick(seen, "read first", 2, 3);
await turn();

lines.push("-- ticks queued by ticks");
let depth = 0;
function deeper(a: number, b: string, c?: unknown, d?: unknown) {
  lines.push("depth " + a + " " + b + " " + show(c) + " " + show(d) + " of " + arguments.length);
  if (++depth < 6) {
    process.nextTick(deeper, depth, "first");
    process.nextTick(deeper, depth, "second", depth * 2);
    if (depth === 3) process.nextTick(deeper, depth, "third", "c", "d");
  }
}
process.nextTick(deeper, 0, "root", "c", "d");
await turn();

lines.push("-- a burst, then fewer arguments in the same places");
let sum = 0;
for (let index = 0; index < 3000; index++) process.nextTick((a: number, b: number, c: number, d: number) => (sum += a + b + c + d), index, 1, 2, 3);
await turn();
lines.push("sum " + sum);
for (let index = 0; index < 3000; index++) process.nextTick(index % 1000 ? () => {} : counted);
await turn();
for (let index = 0; index < 8; index++) process.nextTick(counted, ...Array.from({ length: index % 3 }, () => index));
await turn();

lines.push("-- arguments are let go");
let given = 0;
let neverGiven = 0;
const finalization = new FinalizationRegistry<boolean>(wasGiven => (wasGiven ? given++ : neverGiven++));
(() => {
  for (let count = 1; count <= 6; count++) {
    const held = Array.from({ length: count }, (_, index) => ({ index }));
    for (const object of held) {
      finalization.register(object, true);
      finalization.register({ index: object.index }, false);
    }
    process.nextTick(() => {}, ...held);
  }
})();
await turn();
for (let round = 0; round < 20 && given < 21; round++) {
  Bun.gc(true);
  await turn();
}
lines.push("collected as objects that were never given are: " + (given >= 12 || neverGiven < 12));

lines.push("-- AsyncLocalStorage");
const storage = new AsyncLocalStorage<string>();
storage.run("outer", () => {
  process.nextTick((a: string) => lines.push(a + " sees " + storage.getStore()), "one argument");
  storage.run("inner", () => process.nextTick((a: string, b: string, c: string, d: string, e: string) => lines.push([a, b, c, d, e].join("") + " sees " + storage.getStore()), "f", "i", "v", "e", "!"));
  process.nextTick(() => lines.push("none sees " + storage.getStore()));
});
process.nextTick(() => lines.push("outside sees " + storage.getStore()));
await turn();

lines.push("-- a callback that throws");
process.once("uncaughtException", error => lines.push("uncaught: " + (error as Error).message));
process.nextTick((a: string, b: string) => {
  throw new Error("thrown with " + a + b);
}, "x", "y");
process.nextTick(seen, "behind the throw", 2);
await turn();

lines.push("-- async hooks");
const resources: string[] = [];
const hook = createHook({
  init(_id, type, _trigger, resource) {
    if (type === "TickObject") resources.push(Object.keys(resource).join() + " | " + show((resource as { args?: unknown }).args));
  },
}).enable();
process.nextTick(seen);
process.nextTick(seen, "hooked");
process.nextTick(counted, "hooked", undefined);
process.nextTick(seen, 1, 2, 3, 4, 5, 6);
hook.disable();
process.nextTick(seen, "unhooked", 2);
await turn();
lines.push(...resources);
console.log(lines.join("\n"));
