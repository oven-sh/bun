// A native object typed `any` that satisfies an interface reaches it in many ways: array, map, set and promise methods, `yield`, a static field, a setter, `call` and `apply`, `Object.assign`, containers of `any`. Each case has its own interface, class and native object so that no case affects another. The output must match plain Bun.
const url = "u";

// push
interface Like01 { clear(): void; size: number; on01: ((e: any) => void) | null }
function state01(s: Like01): string { return typeof s.size; }
class Fake01 implements Like01 { size = 1; on01: ((e: any) => void) | null = null; clear() {} }
function make01(): any { const m = new (globalThis as any).Map(); m.on01 = null; return m; }
const fake01 = new Fake01();
{
  const l: Like01[] = [fake01]; l.push(make01()); for (const s of l) console.log(state01(s));
}

// unshift
interface Like02 { clear(): void; size: number; on02: ((e: any) => void) | null }
function state02(s: Like02): string { return typeof s.size; }
class Fake02 implements Like02 { size = 1; on02: ((e: any) => void) | null = null; clear() {} }
function make02(): any { const m = new (globalThis as any).Map(); m.on02 = null; return m; }
const fake02 = new Fake02();
{
  const l: Like02[] = [fake02]; l.unshift(make02()); for (const s of l) console.log(state02(s));
}

// index store
interface Like03 { clear(): void; size: number; on03: ((e: any) => void) | null }
function state03(s: Like03): string { return typeof s.size; }
class Fake03 implements Like03 { size = 1; on03: ((e: any) => void) | null = null; clear() {} }
function make03(): any { const m = new (globalThis as any).Map(); m.on03 = null; return m; }
const fake03 = new Fake03();
{
  const l: Like03[] = [fake03]; l[1] = make03(); for (const s of l) console.log(state03(s));
}

// splice
interface Like04 { clear(): void; size: number; on04: ((e: any) => void) | null }
function state04(s: Like04): string { return typeof s.size; }
class Fake04 implements Like04 { size = 1; on04: ((e: any) => void) | null = null; clear() {} }
function make04(): any { const m = new (globalThis as any).Map(); m.on04 = null; return m; }
const fake04 = new Fake04();
{
  const l: Like04[] = [fake04]; l.splice(0, 0, make04()); for (const s of l) console.log(state04(s));
}

// fill
interface Like05 { clear(): void; size: number; on05: ((e: any) => void) | null }
function state05(s: Like05): string { return typeof s.size; }
class Fake05 implements Like05 { size = 1; on05: ((e: any) => void) | null = null; clear() {} }
function make05(): any { const m = new (globalThis as any).Map(); m.on05 = null; return m; }
const fake05 = new Fake05();
{
  const l: Like05[] = [fake05, fake05]; l.fill(make05(), 1); for (const s of l) console.log(state05(s));
}

// literal
interface Like06 { clear(): void; size: number; on06: ((e: any) => void) | null }
function state06(s: Like06): string { return typeof s.size; }
class Fake06 implements Like06 { size = 1; on06: ((e: any) => void) | null = null; clear() {} }
function make06(): any { const m = new (globalThis as any).Map(); m.on06 = null; return m; }
const fake06 = new Fake06();
{
  const l: Like06[] = [fake06, make06()]; for (const s of l) console.log(state06(s));
}

// array of
interface Like07 { clear(): void; size: number; on07: ((e: any) => void) | null }
function state07(s: Like07): string { return typeof s.size; }
class Fake07 implements Like07 { size = 1; on07: ((e: any) => void) | null = null; clear() {} }
function make07(): any { const m = new (globalThis as any).Map(); m.on07 = null; return m; }
const fake07 = new Fake07();
{
  const l = Array.of<Like07>(fake07, make07()); for (const s of l) console.log(state07(s));
}

// array from
interface Like08 { clear(): void; size: number; on08: ((e: any) => void) | null }
function state08(s: Like08): string { return typeof s.size; }
class Fake08 implements Like08 { size = 1; on08: ((e: any) => void) | null = null; clear() {} }
function make08(): any { const m = new (globalThis as any).Map(); m.on08 = null; return m; }
const fake08 = new Fake08();
{
  const l = Array.from<Like08>([fake08, make08()]); for (const s of l) console.log(state08(s));
}

// map set
interface Like10 { clear(): void; size: number; on10: ((e: any) => void) | null }
function state10(s: Like10): string { return typeof s.size; }
class Fake10 implements Like10 { size = 1; on10: ((e: any) => void) | null = null; clear() {} }
function make10(): any { const m = new (globalThis as any).Map(); m.on10 = null; return m; }
const fake10 = new Fake10();
{
  const m = new Map<string, Like10>(); m.set("f", fake10); m.set("a", make10()); for (const s of m.values()) console.log(state10(s)); console.log(state10(m.get("a")!));
}

// map ctor
interface Like11 { clear(): void; size: number; on11: ((e: any) => void) | null }
function state11(s: Like11): string { return typeof s.size; }
class Fake11 implements Like11 { size = 1; on11: ((e: any) => void) | null = null; clear() {} }
function make11(): any { const m = new (globalThis as any).Map(); m.on11 = null; return m; }
const fake11 = new Fake11();
{
  const m = new Map<string, Like11>([["f", fake11], ["a", make11()]]); for (const s of m.values()) console.log(state11(s));
}

// set add
interface Like12 { clear(): void; size: number; on12: ((e: any) => void) | null }
function state12(s: Like12): string { return typeof s.size; }
class Fake12 implements Like12 { size = 1; on12: ((e: any) => void) | null = null; clear() {} }
function make12(): any { const m = new (globalThis as any).Map(); m.on12 = null; return m; }
const fake12 = new Fake12();
{
  const m = new Set<Like12>(); m.add(fake12); m.add(make12()); for (const s of m) console.log(state12(s));
}

// weakmap
interface Like13 { clear(): void; size: number; on13: ((e: any) => void) | null }
function state13(s: Like13): string { return typeof s.size; }
class Fake13 implements Like13 { size = 1; on13: ((e: any) => void) | null = null; clear() {} }
function make13(): any { const m = new (globalThis as any).Map(); m.on13 = null; return m; }
const fake13 = new Fake13();
{
  const k = {}; const m = new WeakMap<object, Like13>(); m.set(fake13, fake13); m.set(k, make13()); console.log(state13(m.get(k)!));
}

// promise resolve
interface Like14 { clear(): void; size: number; on14: ((e: any) => void) | null }
function state14(s: Like14): string { return typeof s.size; }
class Fake14 implements Like14 { size = 1; on14: ((e: any) => void) | null = null; clear() {} }
function make14(): any { const m = new (globalThis as any).Map(); m.on14 = null; return m; }
const fake14 = new Fake14();
{
  const p = Promise.resolve<Like14>(make14()); console.log(state14(await p), state14(await Promise.resolve<Like14>(fake14)));
}

// promise ctor
interface Like15 { clear(): void; size: number; on15: ((e: any) => void) | null }
function state15(s: Like15): string { return typeof s.size; }
class Fake15 implements Like15 { size = 1; on15: ((e: any) => void) | null = null; clear() {} }
function make15(): any { const m = new (globalThis as any).Map(); m.on15 = null; return m; }
const fake15 = new Fake15();
{
  const p = new Promise<Like15>(r => r(make15())); console.log(state15(await p), state15(await new Promise<Like15>(r => r(fake15))));
}

// generic identity
interface Like16 { clear(): void; size: number; on16: ((e: any) => void) | null }
function state16(s: Like16): string { return typeof s.size; }
class Fake16 implements Like16 { size = 1; on16: ((e: any) => void) | null = null; clear() {} }
function make16(): any { const m = new (globalThis as any).Map(); m.on16 = null; return m; }
const fake16 = new Fake16();
{
  function id<T>(x: T): T { return x; } console.log(state16(id<Like16>(make16())), state16(id<Like16>(fake16)));
}

// literal field
interface Like17 { clear(): void; size: number; on17: ((e: any) => void) | null }
function state17(s: Like17): string { return typeof s.size; }
class Fake17 implements Like17 { size = 1; on17: ((e: any) => void) | null = null; clear() {} }
function make17(): any { const m = new (globalThis as any).Map(); m.on17 = null; return m; }
const fake17 = new Fake17();
{
  type Box = { socket: Like17 }; const b: Box = { socket: make17() }, c: Box = { socket: fake17 }; console.log(state17(b.socket), state17(c.socket));
}

// object assign
interface Like19 { clear(): void; size: number; on19: ((e: any) => void) | null }
function state19(s: Like19): string { return typeof s.size; }
class Fake19 implements Like19 { size = 1; on19: ((e: any) => void) | null = null; clear() {} }
function make19(): any { const m = new (globalThis as any).Map(); m.on19 = null; return m; }
const fake19 = new Fake19();
{
  type Box = { socket: Like19 }; const b: Box = { socket: fake19 }; Object.assign(b, { socket: make19() }); console.log(state19(b.socket));
}

// generator
interface Like20 { clear(): void; size: number; on20: ((e: any) => void) | null }
function state20(s: Like20): string { return typeof s.size; }
class Fake20 implements Like20 { size = 1; on20: ((e: any) => void) | null = null; clear() {} }
function make20(): any { const m = new (globalThis as any).Map(); m.on20 = null; return m; }
const fake20 = new Fake20();
{
  function* g(): Generator<Like20> { yield fake20; yield make20(); } for (const s of g()) console.log(state20(s));
}

// tuple
interface Like21 { clear(): void; size: number; on21: ((e: any) => void) | null }
function state21(s: Like21): string { return typeof s.size; }
class Fake21 implements Like21 { size = 1; on21: ((e: any) => void) | null = null; clear() {} }
function make21(): any { const m = new (globalThis as any).Map(); m.on21 = null; return m; }
const fake21 = new Fake21();
{
  const t: [string, Like21] = ["a", make21()], u: [string, Like21] = ["f", fake21]; console.log(state21(t[1]), state21(u[1]));
}

// record
interface Like22 { clear(): void; size: number; on22: ((e: any) => void) | null }
function state22(s: Like22): string { return typeof s.size; }
class Fake22 implements Like22 { size = 1; on22: ((e: any) => void) | null = null; clear() {} }
function make22(): any { const m = new (globalThis as any).Map(); m.on22 = null; return m; }
const fake22 = new Fake22();
{
  const r: Record<string, Like22> = { f: fake22 }; r.a = make22(); for (const k in r) console.log(state22(r[k]));
}

// rest
interface Like23 { clear(): void; size: number; on23: ((e: any) => void) | null }
function state23(s: Like23): string { return typeof s.size; }
class Fake23 implements Like23 { size = 1; on23: ((e: any) => void) | null = null; clear() {} }
function make23(): any { const m = new (globalThis as any).Map(); m.on23 = null; return m; }
const fake23 = new Fake23();
{
  function all(...l: Like23[]) { for (const s of l) console.log(state23(s)); } all(fake23, make23());
}

// spread call
interface Like24 { clear(): void; size: number; on24: ((e: any) => void) | null }
function state24(s: Like24): string { return typeof s.size; }
class Fake24 implements Like24 { size = 1; on24: ((e: any) => void) | null = null; clear() {} }
function make24(): any { const m = new (globalThis as any).Map(); m.on24 = null; return m; }
const fake24 = new Fake24();
{
  function two(a: Like24, b: Like24) { console.log(state24(a), state24(b)); } const l: any[] = [fake24, make24()]; two(...(l as [Like24, Like24]));
}

// default
interface Like25 { clear(): void; size: number; on25: ((e: any) => void) | null }
function state25(s: Like25): string { return typeof s.size; }
class Fake25 implements Like25 { size = 1; on25: ((e: any) => void) | null = null; clear() {} }
function make25(): any { const m = new (globalThis as any).Map(); m.on25 = null; return m; }
const fake25 = new Fake25();
{
  function d(s: Like25 = make25()) { console.log(state25(s)); } d(); d(fake25);
}

// call apply
interface Like29 { clear(): void; size: number; on29: ((e: any) => void) | null }
function state29(s: Like29): string { return typeof s.size; }
class Fake29 implements Like29 { size = 1; on29: ((e: any) => void) | null = null; clear() {} }
function make29(): any { const m = new (globalThis as any).Map(); m.on29 = null; return m; }
const fake29 = new Fake29();
{
  console.log(state29.call(null, make29()), state29.apply(null, [make29()]), state29(fake29));
}

// map callback
interface Like31 { clear(): void; size: number; on31: ((e: any) => void) | null }
function state31(s: Like31): string { return typeof s.size; }
class Fake31 implements Like31 { size = 1; on31: ((e: any) => void) | null = null; clear() {} }
function make31(): any { const m = new (globalThis as any).Map(); m.on31 = null; return m; }
const fake31 = new Fake31();
{
  const raw: any[] = [fake31, make31()]; console.log(raw.map((s: Like31) => state31(s)).join());
}

// array cast
interface Like32 { clear(): void; size: number; on32: ((e: any) => void) | null }
function state32(s: Like32): string { return typeof s.size; }
class Fake32 implements Like32 { size = 1; on32: ((e: any) => void) | null = null; clear() {} }
function make32(): any { const m = new (globalThis as any).Map(); m.on32 = null; return m; }
const fake32 = new Fake32();
{
  const raw: any[] = [fake32, make32()]; const l = raw as Like32[]; for (const s of l) console.log(state32(s));
}

// then
interface Like33 { clear(): void; size: number; on33: ((e: any) => void) | null }
function state33(s: Like33): string { return typeof s.size; }
class Fake33 implements Like33 { size = 1; on33: ((e: any) => void) | null = null; clear() {} }
function make33(): any { const m = new (globalThis as any).Map(); m.on33 = null; return m; }
const fake33 = new Fake33();
{
  const p: Promise<any> = Promise.resolve(make33()); await p.then((s: Like33) => console.log(state33(s), state33(fake33)));
}

// satisfies
interface Like34 { clear(): void; size: number; on34: ((e: any) => void) | null }
function state34(s: Like34): string { return typeof s.size; }
class Fake34 implements Like34 { size = 1; on34: ((e: any) => void) | null = null; clear() {} }
function make34(): any { const m = new (globalThis as any).Map(); m.on34 = null; return m; }
const fake34 = new Fake34();
{
  const s = make34() satisfies Like34; console.log(state34(s), state34(fake34));
}

// ternary
interface Like35 { clear(): void; size: number; on35: ((e: any) => void) | null }
function state35(s: Like35): string { return typeof s.size; }
class Fake35 implements Like35 { size = 1; on35: ((e: any) => void) | null = null; clear() {} }
function make35(): any { const m = new (globalThis as any).Map(); m.on35 = null; return m; }
const fake35 = new Fake35();
{
  const s: Like35 = url.length > 100 ? fake35 : make35(); console.log(state35(s), state35(fake35));
}

// nullish
interface Like36 { clear(): void; size: number; on36: ((e: any) => void) | null }
function state36(s: Like36): string { return typeof s.size; }
class Fake36 implements Like36 { size = 1; on36: ((e: any) => void) | null = null; clear() {} }
function make36(): any { const m = new (globalThis as any).Map(); m.on36 = null; return m; }
const fake36 = new Fake36();
{
  let n: Like36 | undefined; const s: Like36 = n ?? make36(); console.log(state36(s), state36(fake36));
}

// static
interface Like37 { clear(): void; size: number; on37: ((e: any) => void) | null }
function state37(s: Like37): string { return typeof s.size; }
class Fake37 implements Like37 { size = 1; on37: ((e: any) => void) | null = null; clear() {} }
function make37(): any { const m = new (globalThis as any).Map(); m.on37 = null; return m; }
const fake37 = new Fake37();
{
  class Reg { static current: Like37 = fake37; } Reg.current = make37(); console.log(state37(Reg.current));
}

// closure var
interface Like38 { clear(): void; size: number; on38: ((e: any) => void) | null }
function state38(s: Like38): string { return typeof s.size; }
class Fake38 implements Like38 { size = 1; on38: ((e: any) => void) | null = null; clear() {} }
function make38(): any { const m = new (globalThis as any).Map(); m.on38 = null; return m; }
const fake38 = new Fake38();
{
  let cur: Like38 = fake38; function set(x: any) { cur = x; } set(make38()); console.log(state38(cur));
}

// setter
interface Like39 { clear(): void; size: number; on39: ((e: any) => void) | null }
function state39(s: Like39): string { return typeof s.size; }
class Fake39 implements Like39 { size = 1; on39: ((e: any) => void) | null = null; clear() {} }
function make39(): any { const m = new (globalThis as any).Map(); m.on39 = null; return m; }
const fake39 = new Fake39();
{
  class H { #s: Like39 = fake39; set s(v: Like39) { this.#s = v; } get s() { return this.#s; } } const h = new H(); h.s = make39(); console.log(state39(h.s));
}

// method
interface Like40 { clear(): void; size: number; on40: ((e: any) => void) | null }
function state40(s: Like40): string { return typeof s.size; }
class Fake40 implements Like40 { size = 1; on40: ((e: any) => void) | null = null; clear() {} }
function make40(): any { const m = new (globalThis as any).Map(); m.on40 = null; return m; }
const fake40 = new Fake40();
{
  class H { take(s: Like40) { return state40(s); } } const h = new H(); console.log(h.take(fake40), h.take(make40()));
}

// from entries
interface Like42 { clear(): void; size: number; on42: ((e: any) => void) | null }
function state42(s: Like42): string { return typeof s.size; }
class Fake42 implements Like42 { size = 1; on42: ((e: any) => void) | null = null; clear() {} }
function make42(): any { const m = new (globalThis as any).Map(); m.on42 = null; return m; }
const fake42 = new Fake42();
{
  const r: { [k: string]: Like42 } = Object.fromEntries([["f", fake42], ["a", make42()]]); for (const k in r) console.log(state42(r[k]));
}

// array spread
interface Like43 { clear(): void; size: number; on43: ((e: any) => void) | null }
function state43(s: Like43): string { return typeof s.size; }
class Fake43 implements Like43 { size = 1; on43: ((e: any) => void) | null = null; clear() {} }
function make43(): any { const m = new (globalThis as any).Map(); m.on43 = null; return m; }
const fake43 = new Fake43();
{
  const raw: any[] = [make43()]; const l: Like43[] = [fake43, ...raw]; for (const s of l) console.log(state43(s));
}

// at find
interface Like45 { clear(): void; size: number; on45: ((e: any) => void) | null }
function state45(s: Like45): string { return typeof s.size; }
class Fake45 implements Like45 { size = 1; on45: ((e: any) => void) | null = null; clear() {} }
function make45(): any { const m = new (globalThis as any).Map(); m.on45 = null; return m; }
const fake45 = new Fake45();
{
  const l: Like45[] = [fake45]; l.push(make45()); console.log(state45(l.at(-1)!), state45(l.find(s => s !== fake45)!), state45(l[1]), state45(l.pop()!));
}

// foreach
interface Like46 { clear(): void; size: number; on46: ((e: any) => void) | null }
function state46(s: Like46): string { return typeof s.size; }
class Fake46 implements Like46 { size = 1; on46: ((e: any) => void) | null = null; clear() {} }
function make46(): any { const m = new (globalThis as any).Map(); m.on46 = null; return m; }
const fake46 = new Fake46();
{
  const l: Like46[] = [fake46]; l.push(make46()); l.forEach(s => console.log(state46(s)));
}
