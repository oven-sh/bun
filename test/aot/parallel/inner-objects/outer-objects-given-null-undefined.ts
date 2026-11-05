// Outer objects whose room is never filled: born with an object that has a cell, with null or with undefined: the collector looks into the room all the same.
interface In { u: number; ref: { z: number } | null; name: string }
interface Out { a: In | null | undefined; m: number }
const shared: In = { u: 1, ref: { z: 1 }, name: "shared" };
function laid(i: number): Out { return { a: { u: i, ref: { z: i }, name: "n" + (i & 1) }, m: i }; }
function given(i: number): Out { return { a: shared, m: i }; }
function nulled(i: number): Out { return { a: null, m: i }; }
function undefinedOne(i: number): Out { return { a: undefined, m: i }; }
const kept: Out[] = [];
let sum = 0;
function read(o: Out): number { return o.m + (o.a ? o.a.u + (o.a.ref ? o.a.ref.z : 0) + o.a.name.length : o.a === null ? 1 : 2); }
function fill(round: number): void {
  for (let i = 0; i < 800; i++) {
    const o = laid(i), p = laid(i + 1), q = laid(i + 2);
    if ((i & 3) === 0) kept.push(o, p);
    sum += read(o) + read(p) + read(q);
  }
  for (let i = 0; i < kept.length; i += 3) {
    const o = kept[i];
    if (i % 2) o.a = { u: i, ref: null, name: "again" }; else if (o.a) o.a.ref = { z: round };
  }
}
function rare(k: number): void {
  kept.push(given(k), nulled(k), undefinedOne(k), given(k + 1), nulled(k + 1), undefinedOne(k + 1));
  kept[k * 3].a = null; kept[k * 5 + 1].a = undefined; kept[k * 7 + 2].a = shared;
}
fill(0); rare(1); Bun.gc(true); fill(1); rare(2); Bun.gc(true); fill(2); rare(3); fill(3); rare(4); Bun.gc(true);
for (const o of kept) sum += read(o);
console.log(sum, kept.length, JSON.stringify(kept[1]), JSON.stringify(kept[4]), JSON.stringify(kept[kept.length - 2]));
