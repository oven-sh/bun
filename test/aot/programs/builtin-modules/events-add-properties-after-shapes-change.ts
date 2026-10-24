// node:events stores properties on objects that a program hands it: EventEmitter.call(object) and on() ADD _events, _eventsCount and _maxListeners where they are absent. Each case first runs the same stores many times on one shape, then changes what the next store must obey: an object that may not be extended, is sealed or frozen; a setter or a read-only property of that name that appears up the chain, and goes again; a property that is there already; many shapes by turns; shapes that die and are collected between the runs.
import { EventEmitter } from "node:events";

const lines: string[] = [];
const warm = 300;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const names = ["_events", "_eventsCount", "_maxListeners"];
function made(object: any): string {
  let threw = "";
  try {
    EventEmitter.call(object);
  } catch (error) {
    threw = " threw " + (error as Error).constructor.name;
  }
  return names.map(name => (Object.hasOwn(object, name) ? typeof object[name] : "-")).join() + " keys " + Object.keys(object).join() + threw;
}
function Plain(this: any, tag: number) {
  this.tag = tag;
}
Plain.prototype = Object.create(EventEmitter.prototype);
const fresh = (tag = 0): any => new (Plain as any)(tag);

for (let i = 0; i < warm; i++) made(fresh(i));
lines.push("fresh: " + made(fresh()));
lines.push("twice: " + (() => { const object = fresh(); made(object); return made(object); })());
lines.push("not extensible: " + made(Object.preventExtensions(fresh())));
lines.push("sealed: " + made(Object.seal(fresh())));
lines.push("frozen: " + made(Object.freeze(fresh())));
lines.push("fresh again: " + made(fresh()));
{
  const object = fresh();
  object._eventsCount = 7;
  lines.push("one is there already: " + made(object) + " " + object._eventsCount);
}
{
  const object = fresh();
  Object.defineProperty(object, "_maxListeners", { value: 3, writable: false, configurable: true, enumerable: true });
  lines.push("one is there and read-only: " + made(object) + " " + object._maxListeners);
}

{
  const seen: unknown[] = [];
  Object.defineProperty(Plain.prototype, "_eventsCount", { configurable: true, get: () => 42, set: value => void seen.push(value) });
  const object = fresh();
  lines.push("a setter on the class: " + made(object) + " seen " + seen.join() + " reads " + object._eventsCount);
  delete Plain.prototype._eventsCount;
  lines.push("the setter gone: " + made(fresh()) + " seen " + seen.length);
}
{
  Object.defineProperty(Plain.prototype, "_maxListeners", { configurable: true, value: 5, writable: false });
  const object = fresh();
  lines.push("read-only on the class: " + made(object) + " reads " + object._maxListeners);
  delete Plain.prototype._maxListeners;
  lines.push("gone: " + made(fresh()));
}
{
  const between = Object.create(EventEmitter.prototype);
  const seen: unknown[] = [];
  Object.defineProperty(between, "_events", { configurable: true, get: () => undefined, set: value => void seen.push(typeof value) });
  Object.setPrototypeOf(Plain.prototype, between);
  lines.push("a prototype between with a setter: " + made(fresh()) + " seen " + seen.join());
  Object.setPrototypeOf(Plain.prototype, EventEmitter.prototype);
  lines.push("taken out: " + made(fresh()) + " seen " + seen.length);
}

{
  const makers: (() => any)[] = [];
  for (let i = 0; i < 10; i++) {
    makers.push(() => {
      const object = Object.create(EventEmitter.prototype);
      for (let k = 0; k <= i; k++) object["p" + ((i * 5 + k) % 11)] = k;
      return object;
    });
  }
  let last = "";
  for (let round = 0; round < 40; round++) for (const make of makers) last = made(make());
  lines.push("ten shapes by turns: " + last);
}
{
  let last = "";
  for (let generation = 0; generation < 40; generation++) {
    const prototype = Object.create(EventEmitter.prototype);
    prototype["only" + generation] = generation;
    for (let i = 0; i < 12; i++) {
      const object = Object.create(prototype);
      object["own" + generation] = i;
      last = made(object);
      object.on("x", () => {});
      last += " " + object.listenerCount("x");
    }
    if (generation % 4 === 3) {
      Bun.gc(true);
      await turn();
    }
  }
  lines.push("forty shapes that die: " + last);
}
{
  const wide = fresh();
  for (let i = 0; i < 80; i++) wide["w" + i] = i;
  lines.push("a wide object: " + made(wide).replace(/w\d+,?/g, "").trim());
  const old: any[] = [];
  for (let i = 0; i < 50; i++) old.push(fresh(i));
  Bun.gc(true);
  await turn();
  Bun.gc(true);
  let kept = "";
  for (const object of old) kept = made(object);
  Bun.gc(true);
  lines.push("objects that have been through two collections: " + kept + " " + old.every(object => typeof object._events === "object" && object._eventsCount === 0));
}
console.log(lines.join("\n"));
