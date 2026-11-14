// Env: BUN_JSC_verifyGC=1
// Sixteen fields of a type that only a cast leads to, added in an order that differs from object to object: each lies where a read finds it, whatever came before it, and the keys come in the order of the stores.
interface Holder { id: number }
interface Full extends Holder {
  a: unknown; b: unknown; c: unknown; d: unknown; e: unknown; f: unknown; g: unknown; h: unknown;
  i: unknown; j: unknown; k: unknown; l: unknown; m: unknown; n: unknown; o: unknown; p: unknown;
}
function Holder(this: Holder, id: number) {
  this.id = id;
}
const HolderConstructor = Holder as unknown as new (id: number) => Holder;
const setters: ((h: Full, v: unknown) => void)[] = [
  (h, v) => { h.a = v; }, (h, v) => { h.b = v; }, (h, v) => { h.c = v; }, (h, v) => { h.d = v; },
  (h, v) => { h.e = v; }, (h, v) => { h.f = v; }, (h, v) => { h.g = v; }, (h, v) => { h.h = v; },
  (h, v) => { h.i = v; }, (h, v) => { h.j = v; }, (h, v) => { h.k = v; }, (h, v) => { h.l = v; },
  (h, v) => { h.m = v; }, (h, v) => { h.n = v; }, (h, v) => { h.o = v; }, (h, v) => { h.p = v; },
];
const getters: ((h: Full) => unknown)[] = [
  h => h.a, h => h.b, h => h.c, h => h.d, h => h.e, h => h.f, h => h.g, h => h.h,
  h => h.i, h => h.j, h => h.k, h => h.l, h => h.m, h => h.n, h => h.o, h => h.p,
];
let seed = 12345;
function next(limit: number) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % limit;
}
let wrong = 0, sum = 0;
const kept: [Full, unknown[], number[]][] = [];
for (let round = 0; round < 12000; round++) {
  const holder = new HolderConstructor(round) as Full;
  const order: number[] = [];
  for (let i = 0; i < 16; i++) order.push(i);
  for (let i = 15; i > 0; i--) {
    const j = next(i + 1);
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const count = next(17);
  const expected: unknown[] = new Array(16).fill(undefined);
  for (let step = 0; step < count; step++) {
    const field = order[step];
    const value = step % 3 === 0 ? { round, field } : step % 3 === 1 ? round * 16 + field : "s" + field;
    setters[field](holder, value);
    expected[field] = value;
    for (let i = 0; i < 16; i++) {
      if (getters[i](holder) !== expected[i]) wrong++;
    }
  }
  sum += Object.keys(holder).length;
  if (round % 7 === 0) kept.push([holder, expected, order.slice(0, count)]);
}
function check() {
  for (const [holder, expected, order] of kept) {
    for (let i = 0; i < 16; i++) {
      if (getters[i](holder) !== expected[i]) wrong++;
    }
    const names = Object.keys(holder).join("");
    if (names !== "id" + order.map(i => "abcdefghijklmnop"[i]).join("")) wrong++;
  }
}
check();
// An object that has lived through a collection gets the rest, by stores that know its type, by stores that know nothing and by stores under a name that comes as a value: the collector finds what they bring.
const blindSetters: ((h: any, v: unknown) => void)[] = [
  (h, v) => { h.a = v; }, (h, v) => { h.b = v; }, (h, v) => { h.c = v; }, (h, v) => { h.d = v; },
  (h, v) => { h.e = v; }, (h, v) => { h.f = v; }, (h, v) => { h.g = v; }, (h, v) => { h.h = v; },
  (h, v) => { h.i = v; }, (h, v) => { h.j = v; }, (h, v) => { h.k = v; }, (h, v) => { h.l = v; },
  (h, v) => { h.m = v; }, (h, v) => { h.n = v; }, (h, v) => { h.o = v; }, (h, v) => { h.p = v; },
];
function storeUnderName(h: any, name: string, v: unknown) {
  h[name] = v;
}
for (let pass = 0; pass < 4; pass++) {
  Bun.gc(true);
  let number = 0;
  for (const [holder, expected, order] of kept) {
    number++;
    for (let tries = 0; tries < 4; tries++) {
      const field = next(16);
      if (order.includes(field)) continue;
      const value = tries % 2 ? number * 16 + field : { number, field };
      if (number % 3 === 2) storeUnderName(holder, "abcdefghijklmnop"[field], value);
      else (number % 3 ? setters : blindSetters)[field](holder, value);
      expected[field] = value;
      order.push(field);
    }
  }
  Bun.gc(false);
  check();
}
console.log(wrong, sum, kept.length);
