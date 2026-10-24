"use strict";
function numbers(): number[] { return [1, 2, 3]; }
function fractions(): number[] { return [0.5, 1.5]; }
function long(): number[] { return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]; }
function frozenAtOnce(): readonly number[] { return Object.freeze([4, 5, 6]); }
const attempt = (f: () => unknown) => { try { return JSON.stringify(f()) ?? "undefined"; } catch (e) { return (e as Error).constructor.name; } };
for (const make of [numbers, fractions, long]) {
  for (const [how, lock] of [["freeze", Object.freeze], ["seal", Object.seal], ["preventExtensions", Object.preventExtensions]] as [string, (a: number[]) => number[]][]) {
    const a = lock(make());
    console.log(make.name, how, Object.isFrozen(a), Object.isSealed(a), Object.isExtensible(a), attempt(() => { a[0] = 9; return a; }), attempt(() => a.push(1)), attempt(() => a.pop()), attempt(() => { a.length = 0; return a; }), attempt(() => delete (a as any)[0]), attempt(() => a.sort((x, y) => y - x)), attempt(() => a.reverse()), attempt(() => a.fill(0)), a.join(), make().join(), Object.isFrozen(make()));
    const b = a.slice(); b[0] = 42; b.push(1); console.log(make.name, how, b.join(), a.join(), Object.isFrozen(b), JSON.stringify(Object.getOwnPropertyDescriptor(a, 0)));
  }
}
const f = frozenAtOnce(), g = frozenAtOnce();
console.log(f !== g, Object.isFrozen(f), attempt(() => { (f as number[])[0] = 1; }), f.join(), g.join(), [...f].join(), f.slice().concat(g).join());
