// An object with many fields that are seldom filled keeps some of them outside its cell, and room for those is made when a value needs it.
// `undefined` needs none: it is stored where the room is there already, in a new object, in one that has some of the room, and in one that has all of it.
function given<T>(text: string): T { return JSON.parse(text) as T; }
class Wide {
  id: number; name: string;
  a?: string; b?: number; c?: object; d?: string[]; e?: boolean; f?: Wide; g?: string; h?: number; i?: object; j?: string; k?: number; l?: boolean; m?: string; n?: number; o?: object; p?: string; q?: number; r?: Wide; s?: string; t?: number;
  constructor(id: number, name: string) {
    this.id = id; this.name = name;
    this.a = undefined; this.b = undefined; this.c = undefined; this.d = undefined; this.e = undefined; this.f = undefined; this.g = undefined; this.h = undefined; this.i = undefined; this.j = undefined;
    this.k = undefined; this.l = undefined; this.m = undefined; this.n = undefined; this.o = undefined; this.p = undefined; this.q = undefined; this.r = undefined; this.s = undefined; this.t = undefined;
  }
}
const letters = "abcdefghijklmnopqrst".split("") as (keyof Wide)[];
function show(wide: Wide): string { return wide.id + wide.name + ":" + letters.map(letter => { const value = wide[letter]; return value === undefined ? "-" : typeof value === "object" ? "o" : String(value); }).join("") + ":" + Object.keys(wide).length; }
function clearAll(wide: Wide) {
  wide.a = undefined; wide.b = undefined; wide.c = undefined; wide.d = undefined; wide.e = undefined; wide.f = undefined; wide.g = undefined; wide.h = undefined; wide.i = undefined; wide.j = undefined;
  wide.k = undefined; wide.l = undefined; wide.m = undefined; wide.n = undefined; wide.o = undefined; wide.p = undefined; wide.q = undefined; wide.r = undefined; wide.s = undefined; wide.t = undefined;
}
function clearLast(wide: Wide) { wide.t = undefined; }
function clearSome(wide: Wide) { wide.c = undefined; wide.j = undefined; wide.q = undefined; wide.s = undefined; }
function fillSome(wide: Wide, seed: number) { wide.b = seed; wide.j = "j" + seed; wide.q = seed + 0.5; wide.s = "s"; }
function fillAll(wide: Wide, seed: number) {
  wide.a = "a"; wide.b = seed; wide.c = {}; wide.d = ["d"]; wide.e = true; wide.f = wide; wide.g = "g"; wide.h = seed + 1; wide.i = {}; wide.j = "j";
  wide.k = seed + 2; wide.l = false; wide.m = "m"; wide.n = seed + 3; wide.o = {}; wide.p = "p"; wide.q = seed + 4; wide.r = wide; wide.s = "s"; wide.t = seed + 5;
}
const seed = given<number>("3");

const fresh = new Wide(1, "fresh"); console.log(show(fresh));
clearAll(fresh); clearLast(fresh); clearSome(fresh); console.log(show(fresh));

const partly = new Wide(2, "partly"); fillSome(partly, seed); console.log(show(partly));
clearSome(partly); console.log(show(partly)); fillSome(partly, seed + 1); clearLast(partly); console.log(show(partly)); clearAll(partly); console.log(show(partly));

const full = new Wide(3, "full"); fillAll(full, seed); console.log(show(full));
clearLast(full); console.log(show(full)); clearSome(full); console.log(show(full)); clearAll(full); console.log(show(full)); fillAll(full, seed); console.log(show(full));

// One field at a time: filled, cleared, filled again.
for (const letter of letters) {
  const one = new Wide(4, letter) as unknown as Record<string, unknown>;
  one[letter] = letter; const filled = show(one as unknown as Wide);
  clearAll(one as unknown as Wide); const cleared = show(one as unknown as Wide);
  one[letter] = 7; console.log(filled, cleared, show(one as unknown as Wide), letter in one, Object.hasOwn(one, letter));
}

// Literals that name only some of the fields, and get the others as undefined later.
interface Options { id: number; a?: string; b?: number; c?: object; d?: string; e?: number; f?: string; g?: number; h?: string; i?: number; j?: string; k?: number; l?: string; m?: number; n?: string; o?: number; p?: string }
function blank(options: Options) { options.k = undefined; options.l = undefined; options.m = undefined; options.n = undefined; options.o = undefined; options.p = undefined; }
function list(options: Options): string { return Object.entries(options).map(([key, value]) => key + "=" + value).join(); }
const small: Options = { id: 1 }; blank(small); console.log(list(small));
const medium: Options = { id: 2, a: "a", l: "l", p: "p" }; blank(medium); console.log(list(medium));
const large: Options = { id: 3, a: "a", b: 1, c: {}, d: "d", e: 2, f: "f", g: 3, h: "h", i: 4, j: "j", k: 5, l: "l", m: 6, n: "n", o: 7, p: "p" }; blank(large); console.log(list(large));

// Many, with collections in between.
const kept: Wide[] = [];
for (let i = 0; i < 6000; i++) { const wide = new Wide(i, "w"); if (i % 3 === 0) fillSome(wide, i); if (i % 5 === 0) fillAll(wide, i); if (i % 7 === 0) clearSome(wide); if (i % 11 === 0) clearAll(wide); if (i % 13 === 0) kept.push(wide); if (i % 2000 === 0) Bun.gc(true); }
let sum = 0; for (const wide of kept) sum += show(wide).length + (wide.q ?? 0) + (wide.t ?? 0);
console.log(kept.length, sum, show(kept[5]), show(kept[15]), show(kept[kept.length - 1]));
