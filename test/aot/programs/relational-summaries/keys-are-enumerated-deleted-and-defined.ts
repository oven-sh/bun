// A callee that enumerates the keys of its parameter, deletes one or defines one sees the object as a whole: the order in which members were added, which are enumerable, what the chain adds, what was taken away. An object that was built elsewhere, taken apart or never built must still look the same.
function keysOf(o: object): string {
  return Object.keys(o).join();
}
function forIn(o: object): string {
  const out: string[] = [];
  for (const key in o) out.push(key);
  return out.join();
}
function everything(o: object): string {
  return [keysOf(o), forIn(o), Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).map(String).join(), Object.values(o).join(), Object.entries(o).join(";"), JSON.stringify(o), Object.keys({ ...o }).join()].join(" | ");
}
function point(x: number, y: number) {
  return { x, y };
}
function pointOtherOrder(x: number, y: number) {
  return { y, x };
}
function grown(x: number) {
  const o: Record<string, number> = { x };
  o.z = 1;
  o.y = 2;
  return o;
}
function numbered() {
  return { b: 1, 2: 1, a: 1, 1: 1, "-1": 1, "01": 1, 4294967295: 1, 4294967294: 1 };
}
const hidden = Symbol("hidden");
function withSymbol() {
  return { a: 1, [hidden]: 2, b: 3 };
}
function conditional(flag: boolean) {
  return flag ? { a: 1, b: 2 } : { b: 2, a: 1 };
}
function computed(key: string) {
  return { first: 1, [key]: 2, last: 3 };
}
function duplicated() {
  const more: Record<string, number> = { a: 3, c: 4 };
  return { a: 1, b: 2, ...more };
}
class Base {
  base = 1;
  method() {}
  get accessor() {
    return 1;
  }
}
class Heir extends Base {
  heir = 2;
  static fixed = 3;
}
let warm = 0;
for (let i = 0; i < 500; i++) warm += keysOf(point(i, i)).length + forIn(pointOtherOrder(i, i)).length + keysOf(grown(i)).length + keysOf(new Heir()).length;
console.log(warm);
for (const o of [point(1, 2), pointOtherOrder(1, 2), grown(1), numbered(), withSymbol(), conditional(true), conditional(false), computed("middle"), computed("first"), computed("0"), duplicated(), new Heir(), [5, 6], "ab", Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true }, unseen: { value: 3 } })]) console.log(everything(Object(o)));

// Deleting.
function drop(o: Record<string, unknown>, key: string): boolean {
  return delete o[key];
}
function dropX(o: { x?: number; y: number }): string {
  delete o.x;
  return keysOf(o) + "/" + o.x + "/" + ("x" in o);
}
function dropAndAddAgain(o: { x?: number; y: number }): string {
  delete o.x;
  o.x = 9;
  return keysOf(o);
}
let line = "";
for (let i = 0; i < 300; i++) {
  const p = point(i, i);
  line = [dropX(point(i, 1)), dropAndAddAgain(point(i, 1)), drop(p, "y"), keysOf(p), drop(p, "never there"), p.y].join(" ");
}
console.log(line);
const frozen = Object.freeze(point(1, 2));
try {
  console.log(drop(frozen as never, "x"));
} catch (error) {
  console.log((error as Error).constructor.name, keysOf(frozen));
}
class WithDefault {
  x = 1;
}
(WithDefault.prototype as unknown as { x: number }).x = 100;
const shadowing = new WithDefault();
console.log(shadowing.x, drop(shadowing as never, "x"), shadowing.x, "x" in shadowing, Object.hasOwn(shadowing, "x"));

// Defining.
function hide(o: object, key: string): void {
  Object.defineProperty(o, key, { enumerable: false });
}
function lock(o: object, key: string): void {
  Object.defineProperty(o, key, { writable: false });
}
function turnIntoAccessor(o: object, key: string, log: string[]): void {
  let value = (o as Record<string, unknown>)[key];
  Object.defineProperty(o, key, {
    get() {
      log.push("get " + key);
      return value;
    },
    set(v) {
      log.push("set " + key);
      value = v;
    },
  });
}
function definesNew(o: object): void {
  Object.defineProperty(o, "added", { value: 1, enumerable: true });
  Object.defineProperties(o, { more: { value: 2, enumerable: true }, unseen: { value: 3 } });
}
for (let i = 0; i < 300; i++) {
  const a = point(i, 1);
  hide(a, "x");
  const b = point(i, 1);
  lock(b, "x");
  let threw = false;
  try {
    b.x = -1;
  } catch {
    threw = true;
  }
  const c = point(i, 1);
  const log: string[] = [];
  turnIntoAccessor(c, "y", log);
  c.y += 1;
  const d = point(i, 1);
  definesNew(d);
  line = [keysOf(a), a.x, JSON.stringify(a), threw, b.x, c.y, log.join("+"), keysOf(c), keysOf(d), JSON.stringify(d)].join(" ");
}
console.log(line);

// Keys come and go while they are enumerated.
function enumerateAndChange(o: Record<string, number>): string {
  const seen: string[] = [];
  for (const key in o) {
    seen.push(key);
    if (key === "a") {
      delete o.b;
      o.late = 1;
    }
  }
  return seen.join() + "/" + keysOf(o);
}
console.log(enumerateAndChange({ a: 1, b: 2, c: 3 }));

// Freezing, sealing, preventing extensions, asked and told by helpers.
function state(o: object): string {
  return [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join("");
}
function harden(o: object, how: number): object {
  return how === 0 ? Object.freeze(o) : how === 1 ? Object.seal(o) : how === 2 ? Object.preventExtensions(o) : o;
}
const states: string[] = [];
for (let how = 0; how < 4; how++) {
  const o = point(1, 2) as { x: number; y: number; z?: number };
  const same = harden(o, how) === o;
  const outcome: string[] = [];
  for (const act of [() => void (o.x = 5), () => void (o.z = 5), () => void delete (o as { y?: number }).y]) {
    try {
      act();
      outcome.push("ok");
    } catch {
      outcome.push("threw");
    }
  }
  states.push(same + state(o) + outcome.join("") + JSON.stringify(o));
}
console.log(states.join(" "), state({}), state(Object.freeze([])), state("s" as never));
