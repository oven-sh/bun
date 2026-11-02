// Object.assign of a record with elements onto targets of every kind: stores keep the attributes of what the target has, and what the target has above it may intercept them.
function digest(object: any): string {
  return Reflect.ownKeys(object).map(key => {
    const place = Object.getOwnPropertyDescriptor(object, key)!;
    return String(key) + "=" + String(place.get ? "get" : place.value) + (place.enumerable ? "" : "~") + (place.writable === false ? "!" : "");
  }).join();
}
const source = () => ({ a: 1, b: 2, 0: "zero", 1: "one" });
const sources: Record<string, () => any> = {
  source,
  far: () => ({ a: 1, 5000: "far" }),
  holes: () => { const made: any = source(); delete made[0]; return made; },
  fractions: () => ({ a: 1, 0: 0.5, 1: 1.5 }),
  lost: () => { const made: any = source(); made.z = 1; delete made.z; return made; },
  named: () => { const made: any = source(); made.z = 1; return made; },
  frozen: () => Object.freeze(source()),
};
let asked = 0;
const targets: Record<string, () => any> = {
  empty: () => ({}),
  literal: () => ({ a: "old", c: 3 }),
  "own elements": () => ({ a: 0, 0: "mine", 7: "seven" }),
  "named extra": () => { const made: any = { a: 0 }; made.more = 1; return made; },
  "hidden field": () => Object.defineProperty({ a: 0 }, "b", { value: 9, writable: true, enumerable: false, configurable: true }),
  setter: () => ({ set a(value: number) { asked += value; } }),
  "read-only": () => Object.defineProperty({}, "b", { value: 9, writable: false, configurable: true }),
  "setter above": () => Object.create({ set b(value: number) { asked += 100; } }),
  instance: () => new (class Holder { a = 0; b = 0; })(),
  frozen: () => Object.freeze({ a: 1 }),
  list: () => [],
  proxy: () => new Proxy({}, { set(place, key, value) { asked += 10000; return Reflect.set(place, key, value); } }),
};
for (const [targetName, target] of Object.entries(targets)) {
  for (const [sourceName, make] of Object.entries(sources)) {
    let line = "";
    for (let turn = 0; turn < 12; turn++) {
      try {
        line = digest(Object.assign(target(), make()));
      } catch (error) {
        line = (error as Error).name;
      }
    }
    console.log(targetName, sourceName, line, asked);
  }
}
const kept: any = source();
const copy: any = Object.assign({}, kept);
copy[0] = "changed";
copy[9] = "new";
kept[1] = "later";
console.log(digest(kept), digest(copy));
