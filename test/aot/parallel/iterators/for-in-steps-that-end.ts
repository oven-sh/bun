class Base { one = 1; get two() { return 2; } }
class Child extends Base { three: number; constructor(n: number) { super(); this.three = n; } method() {} }
function made(n: number): any { const o: any = {}; for (let k = 0; k < n; k++) o["p" + k] = k; return o; }
const makers: (() => any)[] = [() => ({ a: 1, b: 2, c: 3 }), () => ({}), () => null, () => undefined, () => [3, , 5], () => "text", () => 7, () => new Uint8Array([4, 5]), () => Object.create({ x: 1, y: 2 }, { z: { value: 3, enumerable: true }, hidden: { value: 4, enumerable: false } }),
  () => new Child(3), () => JSON.parse('{"m":1,"n":[2],"2":3,"1":4}'), () => made(5), () => made(40), () => new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["b", "p", "a"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) })];
function readAll(object: any): string {
  let seen = "", count = 0;
  for (const key in object) { seen += key + ":" + String(object[key]) + ","; count++; }
  return seen + count;
}
function readNested(object: any, other: any): string {
  let sum = 0, last: any = null;
  for (const key in object) {
    if (key === "b") continue;
    for (const inner in other) {
      if (inner === "y") break;
      sum = (sum + inner.length * 3) | 0;
      last = key + inner;
    }
  }
  return sum + ":" + last;
}
function readBehindLoop(object: any): string {
  let key: any = "before", turns = 0;
  for (key in object) {
    if (++turns > 2) break;
    if (turns === 1 && typeof object === "object") delete object.c;
    if (turns === 1 && typeof object === "object" && Object.isExtensible(object)) try { object.added = 1; } catch {}
  }
  return key + ":" + turns;
}
function readInTry(object: any): string {
  let seen = "";
  try {
    for (const key in object) {
      if (key === "y" || key === "p3") return seen + "<" + key;
      try { if (key === "c") throw new Error(key); } catch (error) { seen += "!" + (error as Error).message; }
      seen += key;
    }
  } finally { seen += "|"; }
  return seen;
}
function* steps(object: any) { for (const key in object) yield key; }
async function waits(object: any) { let seen = ""; for (const key in object) { await null; seen += key; } return seen; }
for (let turn = 0; turn < 2; turn++) {
  for (let m = 0; m < makers.length; m++) {
    const maker = makers[m];
    console.log(m, readAll(maker()), readNested(maker(), makers[(m + 5) % makers.length]()), readBehindLoop(maker()), readInTry(maker()), [...steps(maker())].join(), await waits(maker()));
  }
}
export {};
