// Compiled code creates the accessors of a literal in their slots: the pair, the slot, the word of the keys' order. Whatever stands beside them in the literal, and whatever is done to the object behind it, it is the object that plain Bun makes.
// Every maker runs in a loop, where it is copied in line, and through a list of functions, where its own body runs.
function show(o: object): string {
  return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k)!; return String(k) + ":" + (d.get ? "g" + d.get.name : "") + (d.set ? "s" + d.set.name : "") + ("value" in d ? "v" + (typeof d.value === "function" ? "function" : String(d.value)) : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : ""); }).join(" ");
}
function alone(i: number) { return { get x() { return i; } }; }
function pair(i: number) { let held = i; return { get v() { return held; }, set v(n: number) { held = n; } }; }
function setterAlone(i: number) { let seen = i; return { set w(n: number) { seen = n; }, read() { return seen; } }; }
function apart(i: number) { return { get a() { return i; }, m: 1, set a(n: number) { i = n; }, get b() { return i * 2; } }; }
function behindSpread(i: number) { const from: { a?: number; q: number } = i & 1 ? { a: 7, q: 1 } : { q: 2 }; return { ...from, get a() { return i; } }; }
function withPrototype(i: number) { return { __proto__: { below: i }, get a() { return i; } }; }
function usesSuper(i: number) { return { __proto__: { get a() { return 10; } }, get a(): number { return (super.a as number) + i; } }; }
function underNumbers(i: number) { return { get 0() { return i; }, get 1() { return i + 1; }, tail: 3 }; }
function underSymbol(i: number) { return { get [Symbol.toStringTag]() { return "T" + i; }, get plain() { return i; } }; }
function usesThis(i: number) { return { a: i, get x(): number { return this.a + 1; }, get y(): number { return this.a + 2; } }; }
function wide(i: number) {
  return {
    get a0() { return i; }, get a1() { return i + 1; }, get a2() { return i + 2; }, get a3() { return i + 3; }, get a4() { return i + 4; }, get a5() { return i + 5; }, get a6() { return i + 6; }, get a7() { return i + 7; },
    get b0() { return i; }, get b1() { return i + 1; }, get b2() { return i + 2; }, get b3() { return i + 3; }, get b4() { return i + 4; }, get b5() { return i + 5; }, get b6() { return i + 6; }, get b7() { return i + 7; },
    get c0() { return i; }, get c1() { return i + 1; }, get c2() { return i + 2; }, get c3() { return i + 3; }, get c4() { return i + 4; }, get c5() { return i + 5; }, get c6() { return i + 6; }, get c7() { return i + 7; },
    get d0() { return i; }, get d1() { return i + 1; }, get d2() { return i + 2; }, get d3() { return i + 3; }, get d4() { return i + 4; }, get d5() { return i + 5; }, get d6() { return i + 6; }, get d7() { return i + 7; },
    get e0() { return i; }, set e0(n: number) { i = n; }, get e1() { return i + 1; },
  };
}
const makers: ((i: number) => object)[] = [alone, pair, setterAlone, apart, behindSpread, withPrototype, usesSuper, underNumbers, underSymbol, usesThis, wide];
for (const make of makers) for (let i = 1; i < 3; i++) { const o = make(i); console.log(make.name, show(o), JSON.stringify(o), Object.keys(o).join(), JSON.stringify({ ...o })); }

let sum = 0;
for (let i = 0; i < 300; i++) {
  const p = pair(i); p.v = p.v + 1; sum += p.v;
  const s = setterAlone(i); s.w = i + 2; sum += s.read();
  const a = apart(i); a.a = a.a + a.m; sum += a.a + a.b;
  sum += alone(i).x + behindSpread(i).a + withPrototype(i).a + usesSuper(i).a + underNumbers(i)[0] + underNumbers(i)[1] + underSymbol(i).plain + usesThis(i).x + usesThis(i).y;
  const w = wide(i); w.e0 = w.e0 + 1; sum += w.a7 + w.b6 + w.c5 + w.d4 + w.e0 + w.e1;
}
console.log("sum", sum);

const one = alone(1), other = alone(1);
console.log("each evaluation has functions of its own", Object.getOwnPropertyDescriptor(one, "x")!.get !== Object.getOwnPropertyDescriptor(other, "x")!.get);
const above = Object.create(usesThis(5)); above.a = 40; console.log("as a prototype", above.x, above.y, Object.keys(above).join());
const stored = Object.create(pair(3)); stored.v = 9; console.log("a store goes to the setter above", stored.v, Object.keys(stored).length);
const cold = Object.freeze(usesThis(6)); console.log("frozen", cold.x, Object.isFrozen(cold), show(cold));
const changed: any = usesThis(7); delete changed.x; console.log("deleted", show(changed), changed.x); changed.x = 3; console.log("stored anew", show(changed));
const redefined: any = usesThis(8); Object.defineProperty(redefined, "y", { value: 1, enumerable: false }); console.log("redefined", show(redefined), redefined.y);
const halves: any = alone(9); Object.defineProperty(halves, "x", { set(n: number) { this.got = n; } }); halves.x = 4; console.log("a setter joins the getter", show(halves), halves.x, halves.got);
console.log("toString", String(underSymbol(2)), Object.assign({}, underSymbol(3)).plain);
for (const k in apart(4)) console.log("for-in", k);

const ring: { a: number; readonly x: number; readonly y: number }[] = [];
for (let i = 0; i < 64; i++) ring.push(usesThis(i));
let kept = 0;
for (let t = 0; t < 60000; t++) { ring[t & 63] = usesThis(t & 1023); const o = ring[(t + 7) & 63]!; kept = (kept + o.x + o.y) | 0; if ((t & 16383) === 16383) Bun.gc(true); }
console.log("kept through collections", kept);
export {};
