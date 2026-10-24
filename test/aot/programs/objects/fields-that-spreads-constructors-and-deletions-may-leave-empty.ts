// Fields that a spread, a constructor, its helpers or a deletion may leave empty, read by typed code.
const out: string[] = [];
function say(label: string, ...values: unknown[]) { out.push(label + ": " + values.map(v => v === undefined ? "undefined" : typeof v === "bigint" || typeof v === "symbol" ? String(v) : JSON.stringify(v)).join(" ")); }

// Sources of every primitive kind.
type M1 = { a: number; b: string };
function readM1(o: M1) { return o.a + o.b.length; }
function spreadNoText(o: number | boolean | bigint | symbol | null | undefined | Partial<M1>): M1 { return { a: 1, b: "x", ...(o as object) }; }
for (const source of [undefined, null, 5, 1.5, true, 10n, Symbol("s"), { a: 2 }, { b: "yy" }, {}]) { const made = spreadNoText(source); say("1 spread", readM1(made), Object.keys(made).join(), made); }
type T1 = { c: number; d: string };
function readT1(o: T1) { return o.c + o.d.length; }
function spreadText(o: string | undefined | Partial<T1>): T1 { return { c: 1, d: "x", ...(o as object) }; }
for (const source of [undefined, "hi", "", { c: 2 }]) { const made = spreadText(source); say("1 text", readT1(made), Object.keys(made).join(), made); }
type A1 = { e: number; f: string };
function readA1(o: A1) { return o.e + o.f.length; }
function assignAll(...sources: unknown[]): A1 { return Object.assign({ e: 1, f: "x" }, ...sources); }
say("1 assign", readA1(assignAll()), readA1(assignAll(undefined, null, 5, true)), assignAll("ab", 7, { e: 4 }), Object.keys(assignAll("ab")).join());

// Makers of tagged families that show or skip a field.
const enum Kind2 { A = 1, B = 2 }
interface Node2 { kind2: Kind2; pos2: number; end2: number }
interface A2 extends Node2 { kind2: Kind2.A; text2: string }
interface B2 extends Node2 { kind2: Kind2.B; count2: number }
const peeked2: unknown[] = [];
function peek2(n: Node2) { return n.pos2; }
function end2(n: Node2) { return n.end2; }
const Leaky2 = function (this: Node2, kind: Kind2, pos: number, end: number) { this.kind2 = kind; peeked2.push(peek2(this)); this.pos2 = pos; if (end > 0) this.end2 = end; } as unknown as new (kind: Kind2, pos: number, end: number) => Node2;
const a2 = new Leaky2(Kind2.A, 1, 2) as A2, b2 = new Leaky2(Kind2.B, 3, 0) as B2;
a2.text2 = "t"; b2.count2 = 4;
say("2 leaky", peeked2, peek2(a2), peek2(b2), end2(a2), end2(b2), Object.keys(a2).join(), Object.keys(b2).join(), a2, b2);
interface Node2s { kind2s: Kind2; pos2s: number }
interface A2s extends Node2s { kind2s: Kind2.A; text2s: string }
interface B2s extends Node2s { kind2s: Kind2.B; count2s: number }
function pos2s(n: Node2s) { return n.pos2s + n.kind2s; }
const Sound2 = function (this: Node2s, kind: Kind2, pos: number) { this.kind2s = kind; this.pos2s = pos; } as unknown as new (kind: Kind2, pos: number) => Node2s;
class Other2 {}
const plain2: any = {};
(Sound2 as any).call(plain2, Kind2.A, 9);
const odd2 = Reflect.construct(Sound2, [Kind2.B, 8], Other2) as Node2s;
const third2 = new Sound2(3 as Kind2, 7);
const gone2 = new Sound2(Kind2.A, 6); delete (gone2 as any).pos2s;
say("2 sound", pos2s(new Sound2(Kind2.A, 1)), pos2s(new Sound2(Kind2.B, 2)), pos2s(plain2), pos2s(odd2), odd2 instanceof Other2, pos2s(third2), pos2s(gone2), Object.keys(gone2).join());

// A subclass whose constructor never runs, and whose objects exist all the same.
class Base3 { a3 = 1; constructor(public b3: number) {} }
class Dead3 extends Base3 { c3 = 2; static tag3() { return 7; } }
function read3(o: Base3) { return o.a3 + o.b3; }
const made3 = Reflect.construct(Base3, [4], Dead3) as Dead3;
say("3", read3(new Base3(1)), read3(made3), made3.c3, made3 instanceof Dead3, Object.keys(made3).join(), Dead3.tag3());

// Names that helpers of constructors store: always, on one way, behind a look.
const peeked4: unknown[] = [];
function extra4(o: any) { return o.extra4; }
function init4(o: any) { o.extra4 = 5; }
class Always4 { a4 = 1; constructor() { init4(this); } }
class Below4 extends Always4 { b4 = 2; }
function maybe4(o: any, yes: boolean) { if (yes) o.some4 = 6; }
function some4(o: any) { return o.some4; }
class Sometimes4 { a4 = 1; constructor(yes: boolean) { maybe4(this, yes); } }
function late4(o: any) { o.late4 = 7; }
function readLate4(o: any) { return o.late4; }
class Looked4 { a4 = 1; constructor() { peeked4.push(readLate4(this)); late4(this); } }
const deleted4 = new Always4(); delete (deleted4 as any).extra4;
say("4", extra4(new Always4()), extra4(new Below4()), Object.keys(new Below4()).join(), some4(new Sometimes4(true)), some4(new Sometimes4(false)), Object.keys(new Sometimes4(false)).join(), readLate4(new Looked4()), peeked4, extra4(deleted4), Object.keys(deleted4).join());

// Objects in the hands of native code, a deletion and a store through what came back from it.
const kept5 = { x5: 1, y5: 2, z5: 3 };
const other5 = { x5: "s", w5: 4 };
const holder5 = new Map<string, any>([["a", kept5], ["b", other5]]);
function x5(o: { x5: number }) { return o.x5; }
const back5: any = structuredClone({ z5: 1 });
delete back5.z5;
delete holder5.get("a").z5;
function setX5(o: { x5: number; y5: number }) { o.x5 = 1.5; }
setX5(holder5.get("a"));
say("5", x5(kept5), kept5, other5, Object.keys(kept5).join(), back5);

// What a check turns away is stored.
function mk8(o: { s8: string }) { return { v8: o.s8 }; }
function len8(o: { v8: string }) { return o.v8.length; }
const bad8: any = { s8: 1.5, other8: 1 };
say("8", len8(mk8({ s8: "x" })), len8(mk8(bad8)), mk8(bad8));
function mk8s(s: string) { return { w8: s }; }
function len8s(o: { w8: string }) { return o.w8.length; }
say("8s", len8s(mk8s("x")), len8s(mk8s(2.5 as any)), mk8s(2.5 as any));
console.log(out.join("\n"));
