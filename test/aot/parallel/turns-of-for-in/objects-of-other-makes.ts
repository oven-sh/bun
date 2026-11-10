type Point = { x: number; y: number; z: number };
function names(p: Point): string { let s = ""; for (const name in p) s += name + ":" + p[name as keyof Point] + ";"; return s; }
function total(p: Point): number { let s = 0; for (const name in p) s += p[name as keyof Point]; return s; }
const otherOrder: Point = { z: 3, y: 2, x: 1 };
const built = {} as Point; built.y = 2; built.x = 1; built.z = 3;
const withExtra: Point = Object.assign({ x: 1, y: 2, z: 3 }, { w: 4 });
const withIndex: any = { x: 1, y: 2, z: 3 }; withIndex[1] = 10; withIndex[0] = 20;
const withSymbol: any = { x: 1, y: 2, z: 3, [Symbol("s")]: 4 };
const frozen: Point = Object.freeze({ x: 1, y: 2, z: 3 });
const below: any = Object.create({ inherited: 5, x: 100 }); below.x = 1; below.y = 2; below.z = 3;
const relinked: any = { x: 1, y: 2, z: 3 }; Object.setPrototypeOf(relinked, { above: 6 });
const short: any = { x: 1, y: 2 };
const withGetter: any = { x: 1, get y() { return 20; }, z: 3 };
const hidden: any = { x: 1, y: 2, z: 3 }; Object.defineProperty(hidden, "y", { enumerable: false });
const parsed: Point = JSON.parse('{"x":1,"z":3,"y":2}');
const proxy: any = new Proxy({ x: 1, y: 2, z: 3 }, { ownKeys() { return ["z", "x", "y"]; } });
class Three { x = 1; y = 2; z = 3; method() { return 0; } }
const all: any[] = [{ x: 1, y: 2, z: 3 }, otherOrder, built, withExtra, withIndex, withSymbol, frozen, below, relinked, short, withGetter, hidden, parsed, proxy, new Three(), [7, 8], "ab", 5, null, undefined, { x: "a", y: 1n, z: null }];
for (let round = 0; round < 3; round++)
  for (const each of all) console.log(names(each));
let carried = 0;
for (let i = 0; i < 60; i++) carried += total(all[i % 9]);
console.log(carried);
