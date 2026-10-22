// Written by test/aot/generated/objects-born-in-every-place.ts: program(everyCase.filter(the places in-a-literal, three-levels, held-by-the-caller), false, 120): every way of making an object or an array,
// listed at once by the object that holds it, two levels deep, or by the caller. The generated test runs all the places in eleven ways; this file is here for whoever runs the programs alone.
declare const console: { log(...values: unknown[]): void };
const seen = <V>(value: V): V => value;
const TEXTS: string[] = seen(["one", "two", "three", "four"]);
let STORED: unknown = null;
let SEEN = 0;
function see(value: unknown): void { if (typeof value === "object" && value !== null) SEEN++; }
function kept<V>(value: V): V { STORED = value; return value; }
function collect(k: number): void { if (k % 97 === 0) Bun.gc(true); }
function deep(depth: number): number { return depth > 0 ? deep(depth - 1) + 1 : 0; }
function pushed(k: number): number[] { const list: number[] = []; list.push(k); list.push(k + 1); return list; }
function show(value: unknown): string {
  if (typeof value === "function") return "()=>" + show(value());
  if (typeof value !== "object" || value === null) return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) { let text = "["; for (let i = 0; i < value.length; i++) text += (i ? "," : "") + (i in value ? show(value[i]) : "_"); return text + "]"; }
  if (value instanceof Map) return "Map" + show([...value]);
  let text = Object.isFrozen(value) ? "frozen{" : "{";
  for (const key of Object.keys(value)) text += key + ":" + show((value as Record<string, unknown>)[key]) + ";";
  return text + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : Object.getPrototypeOf(value)?.constructor?.name ?? "null");
}
function mix(hash: number, text: string): number { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
type R0 = { a0: number; b0: number; s0: string };
const src0: R0 = seen({ a0: 1, b0: 2.5, s0: "src" }), other0: R0 = seen({ a0: 3, b0: 4, s0: "other" }), wide0 = seen({ extra0: 9, a0: 5, b0: 6, s0: "wide" }), nums0: number[] = seen([1, 2, 3]);
const text0: string = seen(JSON.stringify(src0));
class Made0 { a0: number; b0: number; s0: string; constructor(a: number, b: number, s: string) { this.a0 = a; this.b0 = b; this.s0 = s; } }
class Initialized0 { a0 = 1; b0 = 2.5; s0 = "i"; }
class Empty0A { a0!: number; b0!: number; s0!: string; } class Empty0B { b0!: number; a0!: number; s0!: string; } class Empty0C { s0!: string; a0!: number; b0!: number; }
class Holder0 { inner0: R0; z0: number; constructor(inner: R0, z: number) { this.inner0 = inner; this.z0 = z; } }
function make0(k: number): R0 { return { a0: k, b0: k + 2, s0: "f" }; }
function copy0(from: R0, k: number): R0 { return { ...from, b0: k }; }
function fill0(k: number): R0 { const made = {} as R0; made.a0 = k; made.b0 = 1; made.s0 = "l"; return made; }
function rest0({ extra0, ...rest }: R0 & { extra0: number }): R0 { return rest; }
function choose0(k: number): R0 { let made: R0; switch (k & 3) { case 0: made = new Empty0A(); break; case 1: made = new Empty0B(); break; case 2: made = new Empty0C(); break; default: made = new Empty0A(); break; } made.a0 = k; made.b0 = 2; made.s0 = "w"; return made; }
function list0(k: number): number[] { return [k, k + 2, 5]; }
function hold0(k: number): { kept0: R0; rest0: number } { return { kept0: { a0: k, b0: 8, s0: "held" }, rest0: k }; }
const held0 = seen(hold0(7));
function alone0(k: number): R0 { return (({ a0: k, b0: k + 1, s0: "t" }) as R0); }
function through0(k: number): R0 { return alone0(k + 1); }
function c0(k: number): unknown { return { inner0: (({ a0: k, b0: k + 1, s0: "t" }) as R0), z0: k }; }
type R1 = { a1: number; b1: number; s1: string };
const src1: R1 = seen({ a1: 1, b1: 2.5, s1: "src" }), other1: R1 = seen({ a1: 3, b1: 4, s1: "other" }), wide1 = seen({ extra1: 9, a1: 5, b1: 6, s1: "wide" }), nums1: number[] = seen([1, 2, 3]);
const text1: string = seen(JSON.stringify(src1));
class Made1 { a1: number; b1: number; s1: string; constructor(a: number, b: number, s: string) { this.a1 = a; this.b1 = b; this.s1 = s; } }
class Initialized1 { a1 = 1; b1 = 2.5; s1 = "i"; }
class Empty1A { a1!: number; b1!: number; s1!: string; } class Empty1B { b1!: number; a1!: number; s1!: string; } class Empty1C { s1!: string; a1!: number; b1!: number; }
class Holder1 { inner1: R1; z1: number; constructor(inner: R1, z: number) { this.inner1 = inner; this.z1 = z; } }
function make1(k: number): R1 { return { a1: k, b1: k + 2, s1: "f" }; }
function copy1(from: R1, k: number): R1 { return { ...from, b1: k }; }
function fill1(k: number): R1 { const made = {} as R1; made.a1 = k; made.b1 = 1; made.s1 = "l"; return made; }
function rest1({ extra1, ...rest }: R1 & { extra1: number }): R1 { return rest; }
function choose1(k: number): R1 { let made: R1; switch (k & 3) { case 0: made = new Empty1A(); break; case 1: made = new Empty1B(); break; case 2: made = new Empty1C(); break; default: made = new Empty1A(); break; } made.a1 = k; made.b1 = 2; made.s1 = "w"; return made; }
function list1(k: number): number[] { return [k, k + 2, 5]; }
function hold1(k: number): { kept1: R1; rest1: number } { return { kept1: { a1: k, b1: 8, s1: "held" }, rest1: k }; }
const held1 = seen(hold1(7));
function alone1(k: number): R1 { return (({ a1: k, b1: k + 1, s1: "t" }) as R1); }
function through1(k: number): R1 { return alone1(k + 1); }
function c1(k: number): unknown { return { top1: { inner1: (({ a1: k, b1: k + 1, s1: "t" }) as R1), z1: k }, w1: k + 1 }; }
type R2 = { a2: number; b2: number; s2: string };
const src2: R2 = seen({ a2: 1, b2: 2.5, s2: "src" }), other2: R2 = seen({ a2: 3, b2: 4, s2: "other" }), wide2 = seen({ extra2: 9, a2: 5, b2: 6, s2: "wide" }), nums2: number[] = seen([1, 2, 3]);
const text2: string = seen(JSON.stringify(src2));
class Made2 { a2: number; b2: number; s2: string; constructor(a: number, b: number, s: string) { this.a2 = a; this.b2 = b; this.s2 = s; } }
class Initialized2 { a2 = 1; b2 = 2.5; s2 = "i"; }
class Empty2A { a2!: number; b2!: number; s2!: string; } class Empty2B { b2!: number; a2!: number; s2!: string; } class Empty2C { s2!: string; a2!: number; b2!: number; }
class Holder2 { inner2: R2; z2: number; constructor(inner: R2, z: number) { this.inner2 = inner; this.z2 = z; } }
function make2(k: number): R2 { return { a2: k, b2: k + 2, s2: "f" }; }
function copy2(from: R2, k: number): R2 { return { ...from, b2: k }; }
function fill2(k: number): R2 { const made = {} as R2; made.a2 = k; made.b2 = 1; made.s2 = "l"; return made; }
function rest2({ extra2, ...rest }: R2 & { extra2: number }): R2 { return rest; }
function choose2(k: number): R2 { let made: R2; switch (k & 3) { case 0: made = new Empty2A(); break; case 1: made = new Empty2B(); break; case 2: made = new Empty2C(); break; default: made = new Empty2A(); break; } made.a2 = k; made.b2 = 2; made.s2 = "w"; return made; }
function list2(k: number): number[] { return [k, k + 2, 5]; }
function hold2(k: number): { kept2: R2; rest2: number } { return { kept2: { a2: k, b2: 8, s2: "held" }, rest2: k }; }
const held2 = seen(hold2(7));
function alone2(k: number): R2 { return (({ a2: k, b2: k + 1, s2: "t" }) as R2); }
function through2(k: number): R2 { return alone2(k + 1); }
function c2(k: number): unknown { return { inner2: alone2(k), z2: k }; }
type R3 = { a3: number; b3: number; s3: string };
const src3: R3 = seen({ a3: 1, b3: 2.5, s3: "src" }), other3: R3 = seen({ a3: 3, b3: 4, s3: "other" }), wide3 = seen({ extra3: 9, a3: 5, b3: 6, s3: "wide" }), nums3: number[] = seen([1, 2, 3]);
const text3: string = seen(JSON.stringify(src3));
class Made3 { a3: number; b3: number; s3: string; constructor(a: number, b: number, s: string) { this.a3 = a; this.b3 = b; this.s3 = s; } }
class Initialized3 { a3 = 1; b3 = 2.5; s3 = "i"; }
class Empty3A { a3!: number; b3!: number; s3!: string; } class Empty3B { b3!: number; a3!: number; s3!: string; } class Empty3C { s3!: string; a3!: number; b3!: number; }
class Holder3 { inner3: R3; z3: number; constructor(inner: R3, z: number) { this.inner3 = inner; this.z3 = z; } }
function make3(k: number): R3 { return { a3: k, b3: k + 2, s3: "f" }; }
function copy3(from: R3, k: number): R3 { return { ...from, b3: k }; }
function fill3(k: number): R3 { const made = {} as R3; made.a3 = k; made.b3 = 1; made.s3 = "l"; return made; }
function rest3({ extra3, ...rest }: R3 & { extra3: number }): R3 { return rest; }
function choose3(k: number): R3 { let made: R3; switch (k & 3) { case 0: made = new Empty3A(); break; case 1: made = new Empty3B(); break; case 2: made = new Empty3C(); break; default: made = new Empty3A(); break; } made.a3 = k; made.b3 = 2; made.s3 = "w"; return made; }
function list3(k: number): number[] { return [k, k + 2, 5]; }
function hold3(k: number): { kept3: R3; rest3: number } { return { kept3: { a3: k, b3: 8, s3: "held" }, rest3: k }; }
const held3 = seen(hold3(7));
function alone3(k: number): R3 { return (({ a3: k + 0.5, b3: k / 4, s3: TEXTS[k & 3] }) as R3); }
function through3(k: number): R3 { return alone3(k + 1); }
function c3(k: number): unknown { return { inner3: (({ a3: k + 0.5, b3: k / 4, s3: TEXTS[k & 3] }) as R3), z3: k }; }
type R4 = { a4: number; b4: number; s4: string };
const src4: R4 = seen({ a4: 1, b4: 2.5, s4: "src" }), other4: R4 = seen({ a4: 3, b4: 4, s4: "other" }), wide4 = seen({ extra4: 9, a4: 5, b4: 6, s4: "wide" }), nums4: number[] = seen([1, 2, 3]);
const text4: string = seen(JSON.stringify(src4));
class Made4 { a4: number; b4: number; s4: string; constructor(a: number, b: number, s: string) { this.a4 = a; this.b4 = b; this.s4 = s; } }
class Initialized4 { a4 = 1; b4 = 2.5; s4 = "i"; }
class Empty4A { a4!: number; b4!: number; s4!: string; } class Empty4B { b4!: number; a4!: number; s4!: string; } class Empty4C { s4!: string; a4!: number; b4!: number; }
class Holder4 { inner4: R4; z4: number; constructor(inner: R4, z: number) { this.inner4 = inner; this.z4 = z; } }
function make4(k: number): R4 { return { a4: k, b4: k + 2, s4: "f" }; }
function copy4(from: R4, k: number): R4 { return { ...from, b4: k }; }
function fill4(k: number): R4 { const made = {} as R4; made.a4 = k; made.b4 = 1; made.s4 = "l"; return made; }
function rest4({ extra4, ...rest }: R4 & { extra4: number }): R4 { return rest; }
function choose4(k: number): R4 { let made: R4; switch (k & 3) { case 0: made = new Empty4A(); break; case 1: made = new Empty4B(); break; case 2: made = new Empty4C(); break; default: made = new Empty4A(); break; } made.a4 = k; made.b4 = 2; made.s4 = "w"; return made; }
function list4(k: number): number[] { return [k, k + 2, 5]; }
function hold4(k: number): { kept4: R4; rest4: number } { return { kept4: { a4: k, b4: 8, s4: "held" }, rest4: k }; }
const held4 = seen(hold4(7));
function alone4(k: number): R4 { return (({ a4: k + 0.5, b4: k / 4, s4: TEXTS[k & 3] }) as R4); }
function through4(k: number): R4 { return alone4(k + 1); }
function c4(k: number): unknown { return { top4: { inner4: (({ a4: k + 0.5, b4: k / 4, s4: TEXTS[k & 3] }) as R4), z4: k }, w4: k + 1 }; }
type R5 = { a5: number; b5: number; s5: string };
const src5: R5 = seen({ a5: 1, b5: 2.5, s5: "src" }), other5: R5 = seen({ a5: 3, b5: 4, s5: "other" }), wide5 = seen({ extra5: 9, a5: 5, b5: 6, s5: "wide" }), nums5: number[] = seen([1, 2, 3]);
const text5: string = seen(JSON.stringify(src5));
class Made5 { a5: number; b5: number; s5: string; constructor(a: number, b: number, s: string) { this.a5 = a; this.b5 = b; this.s5 = s; } }
class Initialized5 { a5 = 1; b5 = 2.5; s5 = "i"; }
class Empty5A { a5!: number; b5!: number; s5!: string; } class Empty5B { b5!: number; a5!: number; s5!: string; } class Empty5C { s5!: string; a5!: number; b5!: number; }
class Holder5 { inner5: R5; z5: number; constructor(inner: R5, z: number) { this.inner5 = inner; this.z5 = z; } }
function make5(k: number): R5 { return { a5: k, b5: k + 2, s5: "f" }; }
function copy5(from: R5, k: number): R5 { return { ...from, b5: k }; }
function fill5(k: number): R5 { const made = {} as R5; made.a5 = k; made.b5 = 1; made.s5 = "l"; return made; }
function rest5({ extra5, ...rest }: R5 & { extra5: number }): R5 { return rest; }
function choose5(k: number): R5 { let made: R5; switch (k & 3) { case 0: made = new Empty5A(); break; case 1: made = new Empty5B(); break; case 2: made = new Empty5C(); break; default: made = new Empty5A(); break; } made.a5 = k; made.b5 = 2; made.s5 = "w"; return made; }
function list5(k: number): number[] { return [k, k + 2, 5]; }
function hold5(k: number): { kept5: R5; rest5: number } { return { kept5: { a5: k, b5: 8, s5: "held" }, rest5: k }; }
const held5 = seen(hold5(7));
function alone5(k: number): R5 { return (({ a5: k + 0.5, b5: k / 4, s5: TEXTS[k & 3] }) as R5); }
function through5(k: number): R5 { return alone5(k + 1); }
function c5(k: number): unknown { return { inner5: alone5(k), z5: k }; }
type R6 = { a6: number; b6: number; s6: string };
const src6: R6 = seen({ a6: 1, b6: 2.5, s6: "src" }), other6: R6 = seen({ a6: 3, b6: 4, s6: "other" }), wide6 = seen({ extra6: 9, a6: 5, b6: 6, s6: "wide" }), nums6: number[] = seen([1, 2, 3]);
const text6: string = seen(JSON.stringify(src6));
class Made6 { a6: number; b6: number; s6: string; constructor(a: number, b: number, s: string) { this.a6 = a; this.b6 = b; this.s6 = s; } }
class Initialized6 { a6 = 1; b6 = 2.5; s6 = "i"; }
class Empty6A { a6!: number; b6!: number; s6!: string; } class Empty6B { b6!: number; a6!: number; s6!: string; } class Empty6C { s6!: string; a6!: number; b6!: number; }
class Holder6 { inner6: R6; z6: number; constructor(inner: R6, z: number) { this.inner6 = inner; this.z6 = z; } }
function make6(k: number): R6 { return { a6: k, b6: k + 2, s6: "f" }; }
function copy6(from: R6, k: number): R6 { return { ...from, b6: k }; }
function fill6(k: number): R6 { const made = {} as R6; made.a6 = k; made.b6 = 1; made.s6 = "l"; return made; }
function rest6({ extra6, ...rest }: R6 & { extra6: number }): R6 { return rest; }
function choose6(k: number): R6 { let made: R6; switch (k & 3) { case 0: made = new Empty6A(); break; case 1: made = new Empty6B(); break; case 2: made = new Empty6C(); break; default: made = new Empty6A(); break; } made.a6 = k; made.b6 = 2; made.s6 = "w"; return made; }
function list6(k: number): number[] { return [k, k + 2, 5]; }
function hold6(k: number): { kept6: R6; rest6: number } { return { kept6: { a6: k, b6: 8, s6: "held" }, rest6: k }; }
const held6 = seen(hold6(7));
function alone6(k: number): R6 { return (({ ...src6 }) as R6); }
function through6(k: number): R6 { return alone6(k + 1); }
function c6(k: number): unknown { return { inner6: (({ ...src6 }) as R6), z6: k }; }
type R7 = { a7: number; b7: number; s7: string };
const src7: R7 = seen({ a7: 1, b7: 2.5, s7: "src" }), other7: R7 = seen({ a7: 3, b7: 4, s7: "other" }), wide7 = seen({ extra7: 9, a7: 5, b7: 6, s7: "wide" }), nums7: number[] = seen([1, 2, 3]);
const text7: string = seen(JSON.stringify(src7));
class Made7 { a7: number; b7: number; s7: string; constructor(a: number, b: number, s: string) { this.a7 = a; this.b7 = b; this.s7 = s; } }
class Initialized7 { a7 = 1; b7 = 2.5; s7 = "i"; }
class Empty7A { a7!: number; b7!: number; s7!: string; } class Empty7B { b7!: number; a7!: number; s7!: string; } class Empty7C { s7!: string; a7!: number; b7!: number; }
class Holder7 { inner7: R7; z7: number; constructor(inner: R7, z: number) { this.inner7 = inner; this.z7 = z; } }
function make7(k: number): R7 { return { a7: k, b7: k + 2, s7: "f" }; }
function copy7(from: R7, k: number): R7 { return { ...from, b7: k }; }
function fill7(k: number): R7 { const made = {} as R7; made.a7 = k; made.b7 = 1; made.s7 = "l"; return made; }
function rest7({ extra7, ...rest }: R7 & { extra7: number }): R7 { return rest; }
function choose7(k: number): R7 { let made: R7; switch (k & 3) { case 0: made = new Empty7A(); break; case 1: made = new Empty7B(); break; case 2: made = new Empty7C(); break; default: made = new Empty7A(); break; } made.a7 = k; made.b7 = 2; made.s7 = "w"; return made; }
function list7(k: number): number[] { return [k, k + 2, 5]; }
function hold7(k: number): { kept7: R7; rest7: number } { return { kept7: { a7: k, b7: 8, s7: "held" }, rest7: k }; }
const held7 = seen(hold7(7));
function alone7(k: number): R7 { return (({ ...src7 }) as R7); }
function through7(k: number): R7 { return alone7(k + 1); }
function c7(k: number): unknown { return { top7: { inner7: (({ ...src7 }) as R7), z7: k }, w7: k + 1 }; }
type R8 = { a8: number; b8: number; s8: string };
const src8: R8 = seen({ a8: 1, b8: 2.5, s8: "src" }), other8: R8 = seen({ a8: 3, b8: 4, s8: "other" }), wide8 = seen({ extra8: 9, a8: 5, b8: 6, s8: "wide" }), nums8: number[] = seen([1, 2, 3]);
const text8: string = seen(JSON.stringify(src8));
class Made8 { a8: number; b8: number; s8: string; constructor(a: number, b: number, s: string) { this.a8 = a; this.b8 = b; this.s8 = s; } }
class Initialized8 { a8 = 1; b8 = 2.5; s8 = "i"; }
class Empty8A { a8!: number; b8!: number; s8!: string; } class Empty8B { b8!: number; a8!: number; s8!: string; } class Empty8C { s8!: string; a8!: number; b8!: number; }
class Holder8 { inner8: R8; z8: number; constructor(inner: R8, z: number) { this.inner8 = inner; this.z8 = z; } }
function make8(k: number): R8 { return { a8: k, b8: k + 2, s8: "f" }; }
function copy8(from: R8, k: number): R8 { return { ...from, b8: k }; }
function fill8(k: number): R8 { const made = {} as R8; made.a8 = k; made.b8 = 1; made.s8 = "l"; return made; }
function rest8({ extra8, ...rest }: R8 & { extra8: number }): R8 { return rest; }
function choose8(k: number): R8 { let made: R8; switch (k & 3) { case 0: made = new Empty8A(); break; case 1: made = new Empty8B(); break; case 2: made = new Empty8C(); break; default: made = new Empty8A(); break; } made.a8 = k; made.b8 = 2; made.s8 = "w"; return made; }
function list8(k: number): number[] { return [k, k + 2, 5]; }
function hold8(k: number): { kept8: R8; rest8: number } { return { kept8: { a8: k, b8: 8, s8: "held" }, rest8: k }; }
const held8 = seen(hold8(7));
function alone8(k: number): R8 { return (({ ...src8 }) as R8); }
function through8(k: number): R8 { return alone8(k + 1); }
function c8(k: number): unknown { return { inner8: alone8(k), z8: k }; }
type R9 = { a9: number; b9: number; s9: string };
const src9: R9 = seen({ a9: 1, b9: 2.5, s9: "src" }), other9: R9 = seen({ a9: 3, b9: 4, s9: "other" }), wide9 = seen({ extra9: 9, a9: 5, b9: 6, s9: "wide" }), nums9: number[] = seen([1, 2, 3]);
const text9: string = seen(JSON.stringify(src9));
class Made9 { a9: number; b9: number; s9: string; constructor(a: number, b: number, s: string) { this.a9 = a; this.b9 = b; this.s9 = s; } }
class Initialized9 { a9 = 1; b9 = 2.5; s9 = "i"; }
class Empty9A { a9!: number; b9!: number; s9!: string; } class Empty9B { b9!: number; a9!: number; s9!: string; } class Empty9C { s9!: string; a9!: number; b9!: number; }
class Holder9 { inner9: R9; z9: number; constructor(inner: R9, z: number) { this.inner9 = inner; this.z9 = z; } }
function make9(k: number): R9 { return { a9: k, b9: k + 2, s9: "f" }; }
function copy9(from: R9, k: number): R9 { return { ...from, b9: k }; }
function fill9(k: number): R9 { const made = {} as R9; made.a9 = k; made.b9 = 1; made.s9 = "l"; return made; }
function rest9({ extra9, ...rest }: R9 & { extra9: number }): R9 { return rest; }
function choose9(k: number): R9 { let made: R9; switch (k & 3) { case 0: made = new Empty9A(); break; case 1: made = new Empty9B(); break; case 2: made = new Empty9C(); break; default: made = new Empty9A(); break; } made.a9 = k; made.b9 = 2; made.s9 = "w"; return made; }
function list9(k: number): number[] { return [k, k + 2, 5]; }
function hold9(k: number): { kept9: R9; rest9: number } { return { kept9: { a9: k, b9: 8, s9: "held" }, rest9: k }; }
const held9 = seen(hold9(7));
function alone9(k: number): R9 { return (({ ...src9, a9: k }) as R9); }
function through9(k: number): R9 { return alone9(k + 1); }
function c9(k: number): unknown { return { inner9: (({ ...src9, a9: k }) as R9), z9: k }; }
type R10 = { a10: number; b10: number; s10: string };
const src10: R10 = seen({ a10: 1, b10: 2.5, s10: "src" }), other10: R10 = seen({ a10: 3, b10: 4, s10: "other" }), wide10 = seen({ extra10: 9, a10: 5, b10: 6, s10: "wide" }), nums10: number[] = seen([1, 2, 3]);
const text10: string = seen(JSON.stringify(src10));
class Made10 { a10: number; b10: number; s10: string; constructor(a: number, b: number, s: string) { this.a10 = a; this.b10 = b; this.s10 = s; } }
class Initialized10 { a10 = 1; b10 = 2.5; s10 = "i"; }
class Empty10A { a10!: number; b10!: number; s10!: string; } class Empty10B { b10!: number; a10!: number; s10!: string; } class Empty10C { s10!: string; a10!: number; b10!: number; }
class Holder10 { inner10: R10; z10: number; constructor(inner: R10, z: number) { this.inner10 = inner; this.z10 = z; } }
function make10(k: number): R10 { return { a10: k, b10: k + 2, s10: "f" }; }
function copy10(from: R10, k: number): R10 { return { ...from, b10: k }; }
function fill10(k: number): R10 { const made = {} as R10; made.a10 = k; made.b10 = 1; made.s10 = "l"; return made; }
function rest10({ extra10, ...rest }: R10 & { extra10: number }): R10 { return rest; }
function choose10(k: number): R10 { let made: R10; switch (k & 3) { case 0: made = new Empty10A(); break; case 1: made = new Empty10B(); break; case 2: made = new Empty10C(); break; default: made = new Empty10A(); break; } made.a10 = k; made.b10 = 2; made.s10 = "w"; return made; }
function list10(k: number): number[] { return [k, k + 2, 5]; }
function hold10(k: number): { kept10: R10; rest10: number } { return { kept10: { a10: k, b10: 8, s10: "held" }, rest10: k }; }
const held10 = seen(hold10(7));
function alone10(k: number): R10 { return (({ ...src10, a10: k }) as R10); }
function through10(k: number): R10 { return alone10(k + 1); }
function c10(k: number): unknown { return { top10: { inner10: (({ ...src10, a10: k }) as R10), z10: k }, w10: k + 1 }; }
type R11 = { a11: number; b11: number; s11: string };
const src11: R11 = seen({ a11: 1, b11: 2.5, s11: "src" }), other11: R11 = seen({ a11: 3, b11: 4, s11: "other" }), wide11 = seen({ extra11: 9, a11: 5, b11: 6, s11: "wide" }), nums11: number[] = seen([1, 2, 3]);
const text11: string = seen(JSON.stringify(src11));
class Made11 { a11: number; b11: number; s11: string; constructor(a: number, b: number, s: string) { this.a11 = a; this.b11 = b; this.s11 = s; } }
class Initialized11 { a11 = 1; b11 = 2.5; s11 = "i"; }
class Empty11A { a11!: number; b11!: number; s11!: string; } class Empty11B { b11!: number; a11!: number; s11!: string; } class Empty11C { s11!: string; a11!: number; b11!: number; }
class Holder11 { inner11: R11; z11: number; constructor(inner: R11, z: number) { this.inner11 = inner; this.z11 = z; } }
function make11(k: number): R11 { return { a11: k, b11: k + 2, s11: "f" }; }
function copy11(from: R11, k: number): R11 { return { ...from, b11: k }; }
function fill11(k: number): R11 { const made = {} as R11; made.a11 = k; made.b11 = 1; made.s11 = "l"; return made; }
function rest11({ extra11, ...rest }: R11 & { extra11: number }): R11 { return rest; }
function choose11(k: number): R11 { let made: R11; switch (k & 3) { case 0: made = new Empty11A(); break; case 1: made = new Empty11B(); break; case 2: made = new Empty11C(); break; default: made = new Empty11A(); break; } made.a11 = k; made.b11 = 2; made.s11 = "w"; return made; }
function list11(k: number): number[] { return [k, k + 2, 5]; }
function hold11(k: number): { kept11: R11; rest11: number } { return { kept11: { a11: k, b11: 8, s11: "held" }, rest11: k }; }
const held11 = seen(hold11(7));
function alone11(k: number): R11 { return (({ ...src11, a11: k }) as R11); }
function through11(k: number): R11 { return alone11(k + 1); }
function c11(k: number): unknown { return { inner11: alone11(k), z11: k }; }
type R12 = { a12: number; b12: number; s12: string };
const src12: R12 = seen({ a12: 1, b12: 2.5, s12: "src" }), other12: R12 = seen({ a12: 3, b12: 4, s12: "other" }), wide12 = seen({ extra12: 9, a12: 5, b12: 6, s12: "wide" }), nums12: number[] = seen([1, 2, 3]);
const text12: string = seen(JSON.stringify(src12));
class Made12 { a12: number; b12: number; s12: string; constructor(a: number, b: number, s: string) { this.a12 = a; this.b12 = b; this.s12 = s; } }
class Initialized12 { a12 = 1; b12 = 2.5; s12 = "i"; }
class Empty12A { a12!: number; b12!: number; s12!: string; } class Empty12B { b12!: number; a12!: number; s12!: string; } class Empty12C { s12!: string; a12!: number; b12!: number; }
class Holder12 { inner12: R12; z12: number; constructor(inner: R12, z: number) { this.inner12 = inner; this.z12 = z; } }
function make12(k: number): R12 { return { a12: k, b12: k + 2, s12: "f" }; }
function copy12(from: R12, k: number): R12 { return { ...from, b12: k }; }
function fill12(k: number): R12 { const made = {} as R12; made.a12 = k; made.b12 = 1; made.s12 = "l"; return made; }
function rest12({ extra12, ...rest }: R12 & { extra12: number }): R12 { return rest; }
function choose12(k: number): R12 { let made: R12; switch (k & 3) { case 0: made = new Empty12A(); break; case 1: made = new Empty12B(); break; case 2: made = new Empty12C(); break; default: made = new Empty12A(); break; } made.a12 = k; made.b12 = 2; made.s12 = "w"; return made; }
function list12(k: number): number[] { return [k, k + 2, 5]; }
function hold12(k: number): { kept12: R12; rest12: number } { return { kept12: { a12: k, b12: 8, s12: "held" }, rest12: k }; }
const held12 = seen(hold12(7));
function alone12(k: number): R12 { return (({ ...src12, a12: src12.a12 + 1, s12: TEXTS[k & 3] }) as R12); }
function through12(k: number): R12 { return alone12(k + 1); }
function c12(k: number): unknown { return { inner12: (({ ...src12, a12: src12.a12 + 1, s12: TEXTS[k & 3] }) as R12), z12: k }; }
type R13 = { a13: number; b13: number; s13: string };
const src13: R13 = seen({ a13: 1, b13: 2.5, s13: "src" }), other13: R13 = seen({ a13: 3, b13: 4, s13: "other" }), wide13 = seen({ extra13: 9, a13: 5, b13: 6, s13: "wide" }), nums13: number[] = seen([1, 2, 3]);
const text13: string = seen(JSON.stringify(src13));
class Made13 { a13: number; b13: number; s13: string; constructor(a: number, b: number, s: string) { this.a13 = a; this.b13 = b; this.s13 = s; } }
class Initialized13 { a13 = 1; b13 = 2.5; s13 = "i"; }
class Empty13A { a13!: number; b13!: number; s13!: string; } class Empty13B { b13!: number; a13!: number; s13!: string; } class Empty13C { s13!: string; a13!: number; b13!: number; }
class Holder13 { inner13: R13; z13: number; constructor(inner: R13, z: number) { this.inner13 = inner; this.z13 = z; } }
function make13(k: number): R13 { return { a13: k, b13: k + 2, s13: "f" }; }
function copy13(from: R13, k: number): R13 { return { ...from, b13: k }; }
function fill13(k: number): R13 { const made = {} as R13; made.a13 = k; made.b13 = 1; made.s13 = "l"; return made; }
function rest13({ extra13, ...rest }: R13 & { extra13: number }): R13 { return rest; }
function choose13(k: number): R13 { let made: R13; switch (k & 3) { case 0: made = new Empty13A(); break; case 1: made = new Empty13B(); break; case 2: made = new Empty13C(); break; default: made = new Empty13A(); break; } made.a13 = k; made.b13 = 2; made.s13 = "w"; return made; }
function list13(k: number): number[] { return [k, k + 2, 5]; }
function hold13(k: number): { kept13: R13; rest13: number } { return { kept13: { a13: k, b13: 8, s13: "held" }, rest13: k }; }
const held13 = seen(hold13(7));
function alone13(k: number): R13 { return (({ ...src13, a13: src13.a13 + 1, s13: TEXTS[k & 3] }) as R13); }
function through13(k: number): R13 { return alone13(k + 1); }
function c13(k: number): unknown { return { top13: { inner13: (({ ...src13, a13: src13.a13 + 1, s13: TEXTS[k & 3] }) as R13), z13: k }, w13: k + 1 }; }
type R14 = { a14: number; b14: number; s14: string };
const src14: R14 = seen({ a14: 1, b14: 2.5, s14: "src" }), other14: R14 = seen({ a14: 3, b14: 4, s14: "other" }), wide14 = seen({ extra14: 9, a14: 5, b14: 6, s14: "wide" }), nums14: number[] = seen([1, 2, 3]);
const text14: string = seen(JSON.stringify(src14));
class Made14 { a14: number; b14: number; s14: string; constructor(a: number, b: number, s: string) { this.a14 = a; this.b14 = b; this.s14 = s; } }
class Initialized14 { a14 = 1; b14 = 2.5; s14 = "i"; }
class Empty14A { a14!: number; b14!: number; s14!: string; } class Empty14B { b14!: number; a14!: number; s14!: string; } class Empty14C { s14!: string; a14!: number; b14!: number; }
class Holder14 { inner14: R14; z14: number; constructor(inner: R14, z: number) { this.inner14 = inner; this.z14 = z; } }
function make14(k: number): R14 { return { a14: k, b14: k + 2, s14: "f" }; }
function copy14(from: R14, k: number): R14 { return { ...from, b14: k }; }
function fill14(k: number): R14 { const made = {} as R14; made.a14 = k; made.b14 = 1; made.s14 = "l"; return made; }
function rest14({ extra14, ...rest }: R14 & { extra14: number }): R14 { return rest; }
function choose14(k: number): R14 { let made: R14; switch (k & 3) { case 0: made = new Empty14A(); break; case 1: made = new Empty14B(); break; case 2: made = new Empty14C(); break; default: made = new Empty14A(); break; } made.a14 = k; made.b14 = 2; made.s14 = "w"; return made; }
function list14(k: number): number[] { return [k, k + 2, 5]; }
function hold14(k: number): { kept14: R14; rest14: number } { return { kept14: { a14: k, b14: 8, s14: "held" }, rest14: k }; }
const held14 = seen(hold14(7));
function alone14(k: number): R14 { return (({ ...src14, a14: src14.a14 + 1, s14: TEXTS[k & 3] }) as R14); }
function through14(k: number): R14 { return alone14(k + 1); }
function c14(k: number): unknown { return { inner14: alone14(k), z14: k }; }
type R15 = { a15: number; b15: number; s15: string };
const src15: R15 = seen({ a15: 1, b15: 2.5, s15: "src" }), other15: R15 = seen({ a15: 3, b15: 4, s15: "other" }), wide15 = seen({ extra15: 9, a15: 5, b15: 6, s15: "wide" }), nums15: number[] = seen([1, 2, 3]);
const text15: string = seen(JSON.stringify(src15));
class Made15 { a15: number; b15: number; s15: string; constructor(a: number, b: number, s: string) { this.a15 = a; this.b15 = b; this.s15 = s; } }
class Initialized15 { a15 = 1; b15 = 2.5; s15 = "i"; }
class Empty15A { a15!: number; b15!: number; s15!: string; } class Empty15B { b15!: number; a15!: number; s15!: string; } class Empty15C { s15!: string; a15!: number; b15!: number; }
class Holder15 { inner15: R15; z15: number; constructor(inner: R15, z: number) { this.inner15 = inner; this.z15 = z; } }
function make15(k: number): R15 { return { a15: k, b15: k + 2, s15: "f" }; }
function copy15(from: R15, k: number): R15 { return { ...from, b15: k }; }
function fill15(k: number): R15 { const made = {} as R15; made.a15 = k; made.b15 = 1; made.s15 = "l"; return made; }
function rest15({ extra15, ...rest }: R15 & { extra15: number }): R15 { return rest; }
function choose15(k: number): R15 { let made: R15; switch (k & 3) { case 0: made = new Empty15A(); break; case 1: made = new Empty15B(); break; case 2: made = new Empty15C(); break; default: made = new Empty15A(); break; } made.a15 = k; made.b15 = 2; made.s15 = "w"; return made; }
function list15(k: number): number[] { return [k, k + 2, 5]; }
function hold15(k: number): { kept15: R15; rest15: number } { return { kept15: { a15: k, b15: 8, s15: "held" }, rest15: k }; }
const held15 = seen(hold15(7));
function alone15(k: number): R15 { return (({ a15: k, ...(src15 as Partial<R15>) } as R15) as R15); }
function through15(k: number): R15 { return alone15(k + 1); }
function c15(k: number): unknown { return { inner15: (({ a15: k, ...(src15 as Partial<R15>) } as R15) as R15), z15: k }; }
type R16 = { a16: number; b16: number; s16: string };
const src16: R16 = seen({ a16: 1, b16: 2.5, s16: "src" }), other16: R16 = seen({ a16: 3, b16: 4, s16: "other" }), wide16 = seen({ extra16: 9, a16: 5, b16: 6, s16: "wide" }), nums16: number[] = seen([1, 2, 3]);
const text16: string = seen(JSON.stringify(src16));
class Made16 { a16: number; b16: number; s16: string; constructor(a: number, b: number, s: string) { this.a16 = a; this.b16 = b; this.s16 = s; } }
class Initialized16 { a16 = 1; b16 = 2.5; s16 = "i"; }
class Empty16A { a16!: number; b16!: number; s16!: string; } class Empty16B { b16!: number; a16!: number; s16!: string; } class Empty16C { s16!: string; a16!: number; b16!: number; }
class Holder16 { inner16: R16; z16: number; constructor(inner: R16, z: number) { this.inner16 = inner; this.z16 = z; } }
function make16(k: number): R16 { return { a16: k, b16: k + 2, s16: "f" }; }
function copy16(from: R16, k: number): R16 { return { ...from, b16: k }; }
function fill16(k: number): R16 { const made = {} as R16; made.a16 = k; made.b16 = 1; made.s16 = "l"; return made; }
function rest16({ extra16, ...rest }: R16 & { extra16: number }): R16 { return rest; }
function choose16(k: number): R16 { let made: R16; switch (k & 3) { case 0: made = new Empty16A(); break; case 1: made = new Empty16B(); break; case 2: made = new Empty16C(); break; default: made = new Empty16A(); break; } made.a16 = k; made.b16 = 2; made.s16 = "w"; return made; }
function list16(k: number): number[] { return [k, k + 2, 5]; }
function hold16(k: number): { kept16: R16; rest16: number } { return { kept16: { a16: k, b16: 8, s16: "held" }, rest16: k }; }
const held16 = seen(hold16(7));
function alone16(k: number): R16 { return (({ a16: k, ...(src16 as Partial<R16>) } as R16) as R16); }
function through16(k: number): R16 { return alone16(k + 1); }
function c16(k: number): unknown { return { top16: { inner16: (({ a16: k, ...(src16 as Partial<R16>) } as R16) as R16), z16: k }, w16: k + 1 }; }
type R17 = { a17: number; b17: number; s17: string };
const src17: R17 = seen({ a17: 1, b17: 2.5, s17: "src" }), other17: R17 = seen({ a17: 3, b17: 4, s17: "other" }), wide17 = seen({ extra17: 9, a17: 5, b17: 6, s17: "wide" }), nums17: number[] = seen([1, 2, 3]);
const text17: string = seen(JSON.stringify(src17));
class Made17 { a17: number; b17: number; s17: string; constructor(a: number, b: number, s: string) { this.a17 = a; this.b17 = b; this.s17 = s; } }
class Initialized17 { a17 = 1; b17 = 2.5; s17 = "i"; }
class Empty17A { a17!: number; b17!: number; s17!: string; } class Empty17B { b17!: number; a17!: number; s17!: string; } class Empty17C { s17!: string; a17!: number; b17!: number; }
class Holder17 { inner17: R17; z17: number; constructor(inner: R17, z: number) { this.inner17 = inner; this.z17 = z; } }
function make17(k: number): R17 { return { a17: k, b17: k + 2, s17: "f" }; }
function copy17(from: R17, k: number): R17 { return { ...from, b17: k }; }
function fill17(k: number): R17 { const made = {} as R17; made.a17 = k; made.b17 = 1; made.s17 = "l"; return made; }
function rest17({ extra17, ...rest }: R17 & { extra17: number }): R17 { return rest; }
function choose17(k: number): R17 { let made: R17; switch (k & 3) { case 0: made = new Empty17A(); break; case 1: made = new Empty17B(); break; case 2: made = new Empty17C(); break; default: made = new Empty17A(); break; } made.a17 = k; made.b17 = 2; made.s17 = "w"; return made; }
function list17(k: number): number[] { return [k, k + 2, 5]; }
function hold17(k: number): { kept17: R17; rest17: number } { return { kept17: { a17: k, b17: 8, s17: "held" }, rest17: k }; }
const held17 = seen(hold17(7));
function alone17(k: number): R17 { return (({ a17: k, ...(src17 as Partial<R17>) } as R17) as R17); }
function through17(k: number): R17 { return alone17(k + 1); }
function c17(k: number): unknown { return { inner17: alone17(k), z17: k }; }
type R18 = { a18: number; b18: number; s18: string };
const src18: R18 = seen({ a18: 1, b18: 2.5, s18: "src" }), other18: R18 = seen({ a18: 3, b18: 4, s18: "other" }), wide18 = seen({ extra18: 9, a18: 5, b18: 6, s18: "wide" }), nums18: number[] = seen([1, 2, 3]);
const text18: string = seen(JSON.stringify(src18));
class Made18 { a18: number; b18: number; s18: string; constructor(a: number, b: number, s: string) { this.a18 = a; this.b18 = b; this.s18 = s; } }
class Initialized18 { a18 = 1; b18 = 2.5; s18 = "i"; }
class Empty18A { a18!: number; b18!: number; s18!: string; } class Empty18B { b18!: number; a18!: number; s18!: string; } class Empty18C { s18!: string; a18!: number; b18!: number; }
class Holder18 { inner18: R18; z18: number; constructor(inner: R18, z: number) { this.inner18 = inner; this.z18 = z; } }
function make18(k: number): R18 { return { a18: k, b18: k + 2, s18: "f" }; }
function copy18(from: R18, k: number): R18 { return { ...from, b18: k }; }
function fill18(k: number): R18 { const made = {} as R18; made.a18 = k; made.b18 = 1; made.s18 = "l"; return made; }
function rest18({ extra18, ...rest }: R18 & { extra18: number }): R18 { return rest; }
function choose18(k: number): R18 { let made: R18; switch (k & 3) { case 0: made = new Empty18A(); break; case 1: made = new Empty18B(); break; case 2: made = new Empty18C(); break; default: made = new Empty18A(); break; } made.a18 = k; made.b18 = 2; made.s18 = "w"; return made; }
function list18(k: number): number[] { return [k, k + 2, 5]; }
function hold18(k: number): { kept18: R18; rest18: number } { return { kept18: { a18: k, b18: 8, s18: "held" }, rest18: k }; }
const held18 = seen(hold18(7));
function alone18(k: number): R18 { return (({ ...src18, ...other18 }) as R18); }
function through18(k: number): R18 { return alone18(k + 1); }
function c18(k: number): unknown { return { inner18: (({ ...src18, ...other18 }) as R18), z18: k }; }
type R19 = { a19: number; b19: number; s19: string };
const src19: R19 = seen({ a19: 1, b19: 2.5, s19: "src" }), other19: R19 = seen({ a19: 3, b19: 4, s19: "other" }), wide19 = seen({ extra19: 9, a19: 5, b19: 6, s19: "wide" }), nums19: number[] = seen([1, 2, 3]);
const text19: string = seen(JSON.stringify(src19));
class Made19 { a19: number; b19: number; s19: string; constructor(a: number, b: number, s: string) { this.a19 = a; this.b19 = b; this.s19 = s; } }
class Initialized19 { a19 = 1; b19 = 2.5; s19 = "i"; }
class Empty19A { a19!: number; b19!: number; s19!: string; } class Empty19B { b19!: number; a19!: number; s19!: string; } class Empty19C { s19!: string; a19!: number; b19!: number; }
class Holder19 { inner19: R19; z19: number; constructor(inner: R19, z: number) { this.inner19 = inner; this.z19 = z; } }
function make19(k: number): R19 { return { a19: k, b19: k + 2, s19: "f" }; }
function copy19(from: R19, k: number): R19 { return { ...from, b19: k }; }
function fill19(k: number): R19 { const made = {} as R19; made.a19 = k; made.b19 = 1; made.s19 = "l"; return made; }
function rest19({ extra19, ...rest }: R19 & { extra19: number }): R19 { return rest; }
function choose19(k: number): R19 { let made: R19; switch (k & 3) { case 0: made = new Empty19A(); break; case 1: made = new Empty19B(); break; case 2: made = new Empty19C(); break; default: made = new Empty19A(); break; } made.a19 = k; made.b19 = 2; made.s19 = "w"; return made; }
function list19(k: number): number[] { return [k, k + 2, 5]; }
function hold19(k: number): { kept19: R19; rest19: number } { return { kept19: { a19: k, b19: 8, s19: "held" }, rest19: k }; }
const held19 = seen(hold19(7));
function alone19(k: number): R19 { return (({ ...src19, ...other19 }) as R19); }
function through19(k: number): R19 { return alone19(k + 1); }
function c19(k: number): unknown { return { top19: { inner19: (({ ...src19, ...other19 }) as R19), z19: k }, w19: k + 1 }; }
type R20 = { a20: number; b20: number; s20: string };
const src20: R20 = seen({ a20: 1, b20: 2.5, s20: "src" }), other20: R20 = seen({ a20: 3, b20: 4, s20: "other" }), wide20 = seen({ extra20: 9, a20: 5, b20: 6, s20: "wide" }), nums20: number[] = seen([1, 2, 3]);
const text20: string = seen(JSON.stringify(src20));
class Made20 { a20: number; b20: number; s20: string; constructor(a: number, b: number, s: string) { this.a20 = a; this.b20 = b; this.s20 = s; } }
class Initialized20 { a20 = 1; b20 = 2.5; s20 = "i"; }
class Empty20A { a20!: number; b20!: number; s20!: string; } class Empty20B { b20!: number; a20!: number; s20!: string; } class Empty20C { s20!: string; a20!: number; b20!: number; }
class Holder20 { inner20: R20; z20: number; constructor(inner: R20, z: number) { this.inner20 = inner; this.z20 = z; } }
function make20(k: number): R20 { return { a20: k, b20: k + 2, s20: "f" }; }
function copy20(from: R20, k: number): R20 { return { ...from, b20: k }; }
function fill20(k: number): R20 { const made = {} as R20; made.a20 = k; made.b20 = 1; made.s20 = "l"; return made; }
function rest20({ extra20, ...rest }: R20 & { extra20: number }): R20 { return rest; }
function choose20(k: number): R20 { let made: R20; switch (k & 3) { case 0: made = new Empty20A(); break; case 1: made = new Empty20B(); break; case 2: made = new Empty20C(); break; default: made = new Empty20A(); break; } made.a20 = k; made.b20 = 2; made.s20 = "w"; return made; }
function list20(k: number): number[] { return [k, k + 2, 5]; }
function hold20(k: number): { kept20: R20; rest20: number } { return { kept20: { a20: k, b20: 8, s20: "held" }, rest20: k }; }
const held20 = seen(hold20(7));
function alone20(k: number): R20 { return (({ ...src20, ...other20 }) as R20); }
function through20(k: number): R20 { return alone20(k + 1); }
function c20(k: number): unknown { return { inner20: alone20(k), z20: k }; }
type R21 = { a21: number; b21: number; s21: string };
const src21: R21 = seen({ a21: 1, b21: 2.5, s21: "src" }), other21: R21 = seen({ a21: 3, b21: 4, s21: "other" }), wide21 = seen({ extra21: 9, a21: 5, b21: 6, s21: "wide" }), nums21: number[] = seen([1, 2, 3]);
const text21: string = seen(JSON.stringify(src21));
class Made21 { a21: number; b21: number; s21: string; constructor(a: number, b: number, s: string) { this.a21 = a; this.b21 = b; this.s21 = s; } }
class Initialized21 { a21 = 1; b21 = 2.5; s21 = "i"; }
class Empty21A { a21!: number; b21!: number; s21!: string; } class Empty21B { b21!: number; a21!: number; s21!: string; } class Empty21C { s21!: string; a21!: number; b21!: number; }
class Holder21 { inner21: R21; z21: number; constructor(inner: R21, z: number) { this.inner21 = inner; this.z21 = z; } }
function make21(k: number): R21 { return { a21: k, b21: k + 2, s21: "f" }; }
function copy21(from: R21, k: number): R21 { return { ...from, b21: k }; }
function fill21(k: number): R21 { const made = {} as R21; made.a21 = k; made.b21 = 1; made.s21 = "l"; return made; }
function rest21({ extra21, ...rest }: R21 & { extra21: number }): R21 { return rest; }
function choose21(k: number): R21 { let made: R21; switch (k & 3) { case 0: made = new Empty21A(); break; case 1: made = new Empty21B(); break; case 2: made = new Empty21C(); break; default: made = new Empty21A(); break; } made.a21 = k; made.b21 = 2; made.s21 = "w"; return made; }
function list21(k: number): number[] { return [k, k + 2, 5]; }
function hold21(k: number): { kept21: R21; rest21: number } { return { kept21: { a21: k, b21: 8, s21: "held" }, rest21: k }; }
const held21 = seen(hold21(7));
function alone21(k: number): R21 { return (({ ...(k & 1 ? src21 : other21), b21: k }) as R21); }
function through21(k: number): R21 { return alone21(k + 1); }
function c21(k: number): unknown { return { inner21: (({ ...(k & 1 ? src21 : other21), b21: k }) as R21), z21: k }; }
type R22 = { a22: number; b22: number; s22: string };
const src22: R22 = seen({ a22: 1, b22: 2.5, s22: "src" }), other22: R22 = seen({ a22: 3, b22: 4, s22: "other" }), wide22 = seen({ extra22: 9, a22: 5, b22: 6, s22: "wide" }), nums22: number[] = seen([1, 2, 3]);
const text22: string = seen(JSON.stringify(src22));
class Made22 { a22: number; b22: number; s22: string; constructor(a: number, b: number, s: string) { this.a22 = a; this.b22 = b; this.s22 = s; } }
class Initialized22 { a22 = 1; b22 = 2.5; s22 = "i"; }
class Empty22A { a22!: number; b22!: number; s22!: string; } class Empty22B { b22!: number; a22!: number; s22!: string; } class Empty22C { s22!: string; a22!: number; b22!: number; }
class Holder22 { inner22: R22; z22: number; constructor(inner: R22, z: number) { this.inner22 = inner; this.z22 = z; } }
function make22(k: number): R22 { return { a22: k, b22: k + 2, s22: "f" }; }
function copy22(from: R22, k: number): R22 { return { ...from, b22: k }; }
function fill22(k: number): R22 { const made = {} as R22; made.a22 = k; made.b22 = 1; made.s22 = "l"; return made; }
function rest22({ extra22, ...rest }: R22 & { extra22: number }): R22 { return rest; }
function choose22(k: number): R22 { let made: R22; switch (k & 3) { case 0: made = new Empty22A(); break; case 1: made = new Empty22B(); break; case 2: made = new Empty22C(); break; default: made = new Empty22A(); break; } made.a22 = k; made.b22 = 2; made.s22 = "w"; return made; }
function list22(k: number): number[] { return [k, k + 2, 5]; }
function hold22(k: number): { kept22: R22; rest22: number } { return { kept22: { a22: k, b22: 8, s22: "held" }, rest22: k }; }
const held22 = seen(hold22(7));
function alone22(k: number): R22 { return (({ ...(k & 1 ? src22 : other22), b22: k }) as R22); }
function through22(k: number): R22 { return alone22(k + 1); }
function c22(k: number): unknown { return { top22: { inner22: (({ ...(k & 1 ? src22 : other22), b22: k }) as R22), z22: k }, w22: k + 1 }; }
type R23 = { a23: number; b23: number; s23: string };
const src23: R23 = seen({ a23: 1, b23: 2.5, s23: "src" }), other23: R23 = seen({ a23: 3, b23: 4, s23: "other" }), wide23 = seen({ extra23: 9, a23: 5, b23: 6, s23: "wide" }), nums23: number[] = seen([1, 2, 3]);
const text23: string = seen(JSON.stringify(src23));
class Made23 { a23: number; b23: number; s23: string; constructor(a: number, b: number, s: string) { this.a23 = a; this.b23 = b; this.s23 = s; } }
class Initialized23 { a23 = 1; b23 = 2.5; s23 = "i"; }
class Empty23A { a23!: number; b23!: number; s23!: string; } class Empty23B { b23!: number; a23!: number; s23!: string; } class Empty23C { s23!: string; a23!: number; b23!: number; }
class Holder23 { inner23: R23; z23: number; constructor(inner: R23, z: number) { this.inner23 = inner; this.z23 = z; } }
function make23(k: number): R23 { return { a23: k, b23: k + 2, s23: "f" }; }
function copy23(from: R23, k: number): R23 { return { ...from, b23: k }; }
function fill23(k: number): R23 { const made = {} as R23; made.a23 = k; made.b23 = 1; made.s23 = "l"; return made; }
function rest23({ extra23, ...rest }: R23 & { extra23: number }): R23 { return rest; }
function choose23(k: number): R23 { let made: R23; switch (k & 3) { case 0: made = new Empty23A(); break; case 1: made = new Empty23B(); break; case 2: made = new Empty23C(); break; default: made = new Empty23A(); break; } made.a23 = k; made.b23 = 2; made.s23 = "w"; return made; }
function list23(k: number): number[] { return [k, k + 2, 5]; }
function hold23(k: number): { kept23: R23; rest23: number } { return { kept23: { a23: k, b23: 8, s23: "held" }, rest23: k }; }
const held23 = seen(hold23(7));
function alone23(k: number): R23 { return (({ ...(k & 1 ? src23 : other23), b23: k }) as R23); }
function through23(k: number): R23 { return alone23(k + 1); }
function c23(k: number): unknown { return { inner23: alone23(k), z23: k }; }
type R24 = { a24: number; b24: number; s24: string };
const src24: R24 = seen({ a24: 1, b24: 2.5, s24: "src" }), other24: R24 = seen({ a24: 3, b24: 4, s24: "other" }), wide24 = seen({ extra24: 9, a24: 5, b24: 6, s24: "wide" }), nums24: number[] = seen([1, 2, 3]);
const text24: string = seen(JSON.stringify(src24));
class Made24 { a24: number; b24: number; s24: string; constructor(a: number, b: number, s: string) { this.a24 = a; this.b24 = b; this.s24 = s; } }
class Initialized24 { a24 = 1; b24 = 2.5; s24 = "i"; }
class Empty24A { a24!: number; b24!: number; s24!: string; } class Empty24B { b24!: number; a24!: number; s24!: string; } class Empty24C { s24!: string; a24!: number; b24!: number; }
class Holder24 { inner24: R24; z24: number; constructor(inner: R24, z: number) { this.inner24 = inner; this.z24 = z; } }
function make24(k: number): R24 { return { a24: k, b24: k + 2, s24: "f" }; }
function copy24(from: R24, k: number): R24 { return { ...from, b24: k }; }
function fill24(k: number): R24 { const made = {} as R24; made.a24 = k; made.b24 = 1; made.s24 = "l"; return made; }
function rest24({ extra24, ...rest }: R24 & { extra24: number }): R24 { return rest; }
function choose24(k: number): R24 { let made: R24; switch (k & 3) { case 0: made = new Empty24A(); break; case 1: made = new Empty24B(); break; case 2: made = new Empty24C(); break; default: made = new Empty24A(); break; } made.a24 = k; made.b24 = 2; made.s24 = "w"; return made; }
function list24(k: number): number[] { return [k, k + 2, 5]; }
function hold24(k: number): { kept24: R24; rest24: number } { return { kept24: { a24: k, b24: 8, s24: "held" }, rest24: k }; }
const held24 = seen(hold24(7));
function alone24(k: number): R24 { return ((new Made24(k, k + 1, "c")) as R24); }
function through24(k: number): R24 { return alone24(k + 1); }
function c24(k: number): unknown { return { inner24: ((new Made24(k, k + 1, "c")) as R24), z24: k }; }
type R25 = { a25: number; b25: number; s25: string };
const src25: R25 = seen({ a25: 1, b25: 2.5, s25: "src" }), other25: R25 = seen({ a25: 3, b25: 4, s25: "other" }), wide25 = seen({ extra25: 9, a25: 5, b25: 6, s25: "wide" }), nums25: number[] = seen([1, 2, 3]);
const text25: string = seen(JSON.stringify(src25));
class Made25 { a25: number; b25: number; s25: string; constructor(a: number, b: number, s: string) { this.a25 = a; this.b25 = b; this.s25 = s; } }
class Initialized25 { a25 = 1; b25 = 2.5; s25 = "i"; }
class Empty25A { a25!: number; b25!: number; s25!: string; } class Empty25B { b25!: number; a25!: number; s25!: string; } class Empty25C { s25!: string; a25!: number; b25!: number; }
class Holder25 { inner25: R25; z25: number; constructor(inner: R25, z: number) { this.inner25 = inner; this.z25 = z; } }
function make25(k: number): R25 { return { a25: k, b25: k + 2, s25: "f" }; }
function copy25(from: R25, k: number): R25 { return { ...from, b25: k }; }
function fill25(k: number): R25 { const made = {} as R25; made.a25 = k; made.b25 = 1; made.s25 = "l"; return made; }
function rest25({ extra25, ...rest }: R25 & { extra25: number }): R25 { return rest; }
function choose25(k: number): R25 { let made: R25; switch (k & 3) { case 0: made = new Empty25A(); break; case 1: made = new Empty25B(); break; case 2: made = new Empty25C(); break; default: made = new Empty25A(); break; } made.a25 = k; made.b25 = 2; made.s25 = "w"; return made; }
function list25(k: number): number[] { return [k, k + 2, 5]; }
function hold25(k: number): { kept25: R25; rest25: number } { return { kept25: { a25: k, b25: 8, s25: "held" }, rest25: k }; }
const held25 = seen(hold25(7));
function alone25(k: number): R25 { return ((new Made25(k, k + 1, "c")) as R25); }
function through25(k: number): R25 { return alone25(k + 1); }
function c25(k: number): unknown { return { top25: { inner25: ((new Made25(k, k + 1, "c")) as R25), z25: k }, w25: k + 1 }; }
type R26 = { a26: number; b26: number; s26: string };
const src26: R26 = seen({ a26: 1, b26: 2.5, s26: "src" }), other26: R26 = seen({ a26: 3, b26: 4, s26: "other" }), wide26 = seen({ extra26: 9, a26: 5, b26: 6, s26: "wide" }), nums26: number[] = seen([1, 2, 3]);
const text26: string = seen(JSON.stringify(src26));
class Made26 { a26: number; b26: number; s26: string; constructor(a: number, b: number, s: string) { this.a26 = a; this.b26 = b; this.s26 = s; } }
class Initialized26 { a26 = 1; b26 = 2.5; s26 = "i"; }
class Empty26A { a26!: number; b26!: number; s26!: string; } class Empty26B { b26!: number; a26!: number; s26!: string; } class Empty26C { s26!: string; a26!: number; b26!: number; }
class Holder26 { inner26: R26; z26: number; constructor(inner: R26, z: number) { this.inner26 = inner; this.z26 = z; } }
function make26(k: number): R26 { return { a26: k, b26: k + 2, s26: "f" }; }
function copy26(from: R26, k: number): R26 { return { ...from, b26: k }; }
function fill26(k: number): R26 { const made = {} as R26; made.a26 = k; made.b26 = 1; made.s26 = "l"; return made; }
function rest26({ extra26, ...rest }: R26 & { extra26: number }): R26 { return rest; }
function choose26(k: number): R26 { let made: R26; switch (k & 3) { case 0: made = new Empty26A(); break; case 1: made = new Empty26B(); break; case 2: made = new Empty26C(); break; default: made = new Empty26A(); break; } made.a26 = k; made.b26 = 2; made.s26 = "w"; return made; }
function list26(k: number): number[] { return [k, k + 2, 5]; }
function hold26(k: number): { kept26: R26; rest26: number } { return { kept26: { a26: k, b26: 8, s26: "held" }, rest26: k }; }
const held26 = seen(hold26(7));
function alone26(k: number): R26 { return ((new Made26(k, k + 1, "c")) as R26); }
function through26(k: number): R26 { return alone26(k + 1); }
function c26(k: number): unknown { return { inner26: alone26(k), z26: k }; }
type R27 = { a27: number; b27: number; s27: string };
const src27: R27 = seen({ a27: 1, b27: 2.5, s27: "src" }), other27: R27 = seen({ a27: 3, b27: 4, s27: "other" }), wide27 = seen({ extra27: 9, a27: 5, b27: 6, s27: "wide" }), nums27: number[] = seen([1, 2, 3]);
const text27: string = seen(JSON.stringify(src27));
class Made27 { a27: number; b27: number; s27: string; constructor(a: number, b: number, s: string) { this.a27 = a; this.b27 = b; this.s27 = s; } }
class Initialized27 { a27 = 1; b27 = 2.5; s27 = "i"; }
class Empty27A { a27!: number; b27!: number; s27!: string; } class Empty27B { b27!: number; a27!: number; s27!: string; } class Empty27C { s27!: string; a27!: number; b27!: number; }
class Holder27 { inner27: R27; z27: number; constructor(inner: R27, z: number) { this.inner27 = inner; this.z27 = z; } }
function make27(k: number): R27 { return { a27: k, b27: k + 2, s27: "f" }; }
function copy27(from: R27, k: number): R27 { return { ...from, b27: k }; }
function fill27(k: number): R27 { const made = {} as R27; made.a27 = k; made.b27 = 1; made.s27 = "l"; return made; }
function rest27({ extra27, ...rest }: R27 & { extra27: number }): R27 { return rest; }
function choose27(k: number): R27 { let made: R27; switch (k & 3) { case 0: made = new Empty27A(); break; case 1: made = new Empty27B(); break; case 2: made = new Empty27C(); break; default: made = new Empty27A(); break; } made.a27 = k; made.b27 = 2; made.s27 = "w"; return made; }
function list27(k: number): number[] { return [k, k + 2, 5]; }
function hold27(k: number): { kept27: R27; rest27: number } { return { kept27: { a27: k, b27: 8, s27: "held" }, rest27: k }; }
const held27 = seen(hold27(7));
function alone27(k: number): R27 { return ((new Initialized27()) as R27); }
function through27(k: number): R27 { return alone27(k + 1); }
function c27(k: number): unknown { return { inner27: ((new Initialized27()) as R27), z27: k }; }
type R28 = { a28: number; b28: number; s28: string };
const src28: R28 = seen({ a28: 1, b28: 2.5, s28: "src" }), other28: R28 = seen({ a28: 3, b28: 4, s28: "other" }), wide28 = seen({ extra28: 9, a28: 5, b28: 6, s28: "wide" }), nums28: number[] = seen([1, 2, 3]);
const text28: string = seen(JSON.stringify(src28));
class Made28 { a28: number; b28: number; s28: string; constructor(a: number, b: number, s: string) { this.a28 = a; this.b28 = b; this.s28 = s; } }
class Initialized28 { a28 = 1; b28 = 2.5; s28 = "i"; }
class Empty28A { a28!: number; b28!: number; s28!: string; } class Empty28B { b28!: number; a28!: number; s28!: string; } class Empty28C { s28!: string; a28!: number; b28!: number; }
class Holder28 { inner28: R28; z28: number; constructor(inner: R28, z: number) { this.inner28 = inner; this.z28 = z; } }
function make28(k: number): R28 { return { a28: k, b28: k + 2, s28: "f" }; }
function copy28(from: R28, k: number): R28 { return { ...from, b28: k }; }
function fill28(k: number): R28 { const made = {} as R28; made.a28 = k; made.b28 = 1; made.s28 = "l"; return made; }
function rest28({ extra28, ...rest }: R28 & { extra28: number }): R28 { return rest; }
function choose28(k: number): R28 { let made: R28; switch (k & 3) { case 0: made = new Empty28A(); break; case 1: made = new Empty28B(); break; case 2: made = new Empty28C(); break; default: made = new Empty28A(); break; } made.a28 = k; made.b28 = 2; made.s28 = "w"; return made; }
function list28(k: number): number[] { return [k, k + 2, 5]; }
function hold28(k: number): { kept28: R28; rest28: number } { return { kept28: { a28: k, b28: 8, s28: "held" }, rest28: k }; }
const held28 = seen(hold28(7));
function alone28(k: number): R28 { return ((new Initialized28()) as R28); }
function through28(k: number): R28 { return alone28(k + 1); }
function c28(k: number): unknown { return { top28: { inner28: ((new Initialized28()) as R28), z28: k }, w28: k + 1 }; }
type R29 = { a29: number; b29: number; s29: string };
const src29: R29 = seen({ a29: 1, b29: 2.5, s29: "src" }), other29: R29 = seen({ a29: 3, b29: 4, s29: "other" }), wide29 = seen({ extra29: 9, a29: 5, b29: 6, s29: "wide" }), nums29: number[] = seen([1, 2, 3]);
const text29: string = seen(JSON.stringify(src29));
class Made29 { a29: number; b29: number; s29: string; constructor(a: number, b: number, s: string) { this.a29 = a; this.b29 = b; this.s29 = s; } }
class Initialized29 { a29 = 1; b29 = 2.5; s29 = "i"; }
class Empty29A { a29!: number; b29!: number; s29!: string; } class Empty29B { b29!: number; a29!: number; s29!: string; } class Empty29C { s29!: string; a29!: number; b29!: number; }
class Holder29 { inner29: R29; z29: number; constructor(inner: R29, z: number) { this.inner29 = inner; this.z29 = z; } }
function make29(k: number): R29 { return { a29: k, b29: k + 2, s29: "f" }; }
function copy29(from: R29, k: number): R29 { return { ...from, b29: k }; }
function fill29(k: number): R29 { const made = {} as R29; made.a29 = k; made.b29 = 1; made.s29 = "l"; return made; }
function rest29({ extra29, ...rest }: R29 & { extra29: number }): R29 { return rest; }
function choose29(k: number): R29 { let made: R29; switch (k & 3) { case 0: made = new Empty29A(); break; case 1: made = new Empty29B(); break; case 2: made = new Empty29C(); break; default: made = new Empty29A(); break; } made.a29 = k; made.b29 = 2; made.s29 = "w"; return made; }
function list29(k: number): number[] { return [k, k + 2, 5]; }
function hold29(k: number): { kept29: R29; rest29: number } { return { kept29: { a29: k, b29: 8, s29: "held" }, rest29: k }; }
const held29 = seen(hold29(7));
function alone29(k: number): R29 { return ((new Initialized29()) as R29); }
function through29(k: number): R29 { return alone29(k + 1); }
function c29(k: number): unknown { return { inner29: alone29(k), z29: k }; }
type R30 = { a30: number; b30: number; s30: string };
const src30: R30 = seen({ a30: 1, b30: 2.5, s30: "src" }), other30: R30 = seen({ a30: 3, b30: 4, s30: "other" }), wide30 = seen({ extra30: 9, a30: 5, b30: 6, s30: "wide" }), nums30: number[] = seen([1, 2, 3]);
const text30: string = seen(JSON.stringify(src30));
class Made30 { a30: number; b30: number; s30: string; constructor(a: number, b: number, s: string) { this.a30 = a; this.b30 = b; this.s30 = s; } }
class Initialized30 { a30 = 1; b30 = 2.5; s30 = "i"; }
class Empty30A { a30!: number; b30!: number; s30!: string; } class Empty30B { b30!: number; a30!: number; s30!: string; } class Empty30C { s30!: string; a30!: number; b30!: number; }
class Holder30 { inner30: R30; z30: number; constructor(inner: R30, z: number) { this.inner30 = inner; this.z30 = z; } }
function make30(k: number): R30 { return { a30: k, b30: k + 2, s30: "f" }; }
function copy30(from: R30, k: number): R30 { return { ...from, b30: k }; }
function fill30(k: number): R30 { const made = {} as R30; made.a30 = k; made.b30 = 1; made.s30 = "l"; return made; }
function rest30({ extra30, ...rest }: R30 & { extra30: number }): R30 { return rest; }
function choose30(k: number): R30 { let made: R30; switch (k & 3) { case 0: made = new Empty30A(); break; case 1: made = new Empty30B(); break; case 2: made = new Empty30C(); break; default: made = new Empty30A(); break; } made.a30 = k; made.b30 = 2; made.s30 = "w"; return made; }
function list30(k: number): number[] { return [k, k + 2, 5]; }
function hold30(k: number): { kept30: R30; rest30: number } { return { kept30: { a30: k, b30: 8, s30: "held" }, rest30: k }; }
const held30 = seen(hold30(7));
function alone30(k: number): R30 { return ((make30(k)) as R30); }
function through30(k: number): R30 { return alone30(k + 1); }
function c30(k: number): unknown { return { inner30: ((make30(k)) as R30), z30: k }; }
type R31 = { a31: number; b31: number; s31: string };
const src31: R31 = seen({ a31: 1, b31: 2.5, s31: "src" }), other31: R31 = seen({ a31: 3, b31: 4, s31: "other" }), wide31 = seen({ extra31: 9, a31: 5, b31: 6, s31: "wide" }), nums31: number[] = seen([1, 2, 3]);
const text31: string = seen(JSON.stringify(src31));
class Made31 { a31: number; b31: number; s31: string; constructor(a: number, b: number, s: string) { this.a31 = a; this.b31 = b; this.s31 = s; } }
class Initialized31 { a31 = 1; b31 = 2.5; s31 = "i"; }
class Empty31A { a31!: number; b31!: number; s31!: string; } class Empty31B { b31!: number; a31!: number; s31!: string; } class Empty31C { s31!: string; a31!: number; b31!: number; }
class Holder31 { inner31: R31; z31: number; constructor(inner: R31, z: number) { this.inner31 = inner; this.z31 = z; } }
function make31(k: number): R31 { return { a31: k, b31: k + 2, s31: "f" }; }
function copy31(from: R31, k: number): R31 { return { ...from, b31: k }; }
function fill31(k: number): R31 { const made = {} as R31; made.a31 = k; made.b31 = 1; made.s31 = "l"; return made; }
function rest31({ extra31, ...rest }: R31 & { extra31: number }): R31 { return rest; }
function choose31(k: number): R31 { let made: R31; switch (k & 3) { case 0: made = new Empty31A(); break; case 1: made = new Empty31B(); break; case 2: made = new Empty31C(); break; default: made = new Empty31A(); break; } made.a31 = k; made.b31 = 2; made.s31 = "w"; return made; }
function list31(k: number): number[] { return [k, k + 2, 5]; }
function hold31(k: number): { kept31: R31; rest31: number } { return { kept31: { a31: k, b31: 8, s31: "held" }, rest31: k }; }
const held31 = seen(hold31(7));
function alone31(k: number): R31 { return ((make31(k)) as R31); }
function through31(k: number): R31 { return alone31(k + 1); }
function c31(k: number): unknown { return { top31: { inner31: ((make31(k)) as R31), z31: k }, w31: k + 1 }; }
type R32 = { a32: number; b32: number; s32: string };
const src32: R32 = seen({ a32: 1, b32: 2.5, s32: "src" }), other32: R32 = seen({ a32: 3, b32: 4, s32: "other" }), wide32 = seen({ extra32: 9, a32: 5, b32: 6, s32: "wide" }), nums32: number[] = seen([1, 2, 3]);
const text32: string = seen(JSON.stringify(src32));
class Made32 { a32: number; b32: number; s32: string; constructor(a: number, b: number, s: string) { this.a32 = a; this.b32 = b; this.s32 = s; } }
class Initialized32 { a32 = 1; b32 = 2.5; s32 = "i"; }
class Empty32A { a32!: number; b32!: number; s32!: string; } class Empty32B { b32!: number; a32!: number; s32!: string; } class Empty32C { s32!: string; a32!: number; b32!: number; }
class Holder32 { inner32: R32; z32: number; constructor(inner: R32, z: number) { this.inner32 = inner; this.z32 = z; } }
function make32(k: number): R32 { return { a32: k, b32: k + 2, s32: "f" }; }
function copy32(from: R32, k: number): R32 { return { ...from, b32: k }; }
function fill32(k: number): R32 { const made = {} as R32; made.a32 = k; made.b32 = 1; made.s32 = "l"; return made; }
function rest32({ extra32, ...rest }: R32 & { extra32: number }): R32 { return rest; }
function choose32(k: number): R32 { let made: R32; switch (k & 3) { case 0: made = new Empty32A(); break; case 1: made = new Empty32B(); break; case 2: made = new Empty32C(); break; default: made = new Empty32A(); break; } made.a32 = k; made.b32 = 2; made.s32 = "w"; return made; }
function list32(k: number): number[] { return [k, k + 2, 5]; }
function hold32(k: number): { kept32: R32; rest32: number } { return { kept32: { a32: k, b32: 8, s32: "held" }, rest32: k }; }
const held32 = seen(hold32(7));
function alone32(k: number): R32 { return ((make32(k)) as R32); }
function through32(k: number): R32 { return alone32(k + 1); }
function c32(k: number): unknown { return { inner32: alone32(k), z32: k }; }
type R33 = { a33: number; b33: number; s33: string };
const src33: R33 = seen({ a33: 1, b33: 2.5, s33: "src" }), other33: R33 = seen({ a33: 3, b33: 4, s33: "other" }), wide33 = seen({ extra33: 9, a33: 5, b33: 6, s33: "wide" }), nums33: number[] = seen([1, 2, 3]);
const text33: string = seen(JSON.stringify(src33));
class Made33 { a33: number; b33: number; s33: string; constructor(a: number, b: number, s: string) { this.a33 = a; this.b33 = b; this.s33 = s; } }
class Initialized33 { a33 = 1; b33 = 2.5; s33 = "i"; }
class Empty33A { a33!: number; b33!: number; s33!: string; } class Empty33B { b33!: number; a33!: number; s33!: string; } class Empty33C { s33!: string; a33!: number; b33!: number; }
class Holder33 { inner33: R33; z33: number; constructor(inner: R33, z: number) { this.inner33 = inner; this.z33 = z; } }
function make33(k: number): R33 { return { a33: k, b33: k + 2, s33: "f" }; }
function copy33(from: R33, k: number): R33 { return { ...from, b33: k }; }
function fill33(k: number): R33 { const made = {} as R33; made.a33 = k; made.b33 = 1; made.s33 = "l"; return made; }
function rest33({ extra33, ...rest }: R33 & { extra33: number }): R33 { return rest; }
function choose33(k: number): R33 { let made: R33; switch (k & 3) { case 0: made = new Empty33A(); break; case 1: made = new Empty33B(); break; case 2: made = new Empty33C(); break; default: made = new Empty33A(); break; } made.a33 = k; made.b33 = 2; made.s33 = "w"; return made; }
function list33(k: number): number[] { return [k, k + 2, 5]; }
function hold33(k: number): { kept33: R33; rest33: number } { return { kept33: { a33: k, b33: 8, s33: "held" }, rest33: k }; }
const held33 = seen(hold33(7));
function alone33(k: number): R33 { return ((copy33(src33, k)) as R33); }
function through33(k: number): R33 { return alone33(k + 1); }
function c33(k: number): unknown { return { inner33: ((copy33(src33, k)) as R33), z33: k }; }
type R34 = { a34: number; b34: number; s34: string };
const src34: R34 = seen({ a34: 1, b34: 2.5, s34: "src" }), other34: R34 = seen({ a34: 3, b34: 4, s34: "other" }), wide34 = seen({ extra34: 9, a34: 5, b34: 6, s34: "wide" }), nums34: number[] = seen([1, 2, 3]);
const text34: string = seen(JSON.stringify(src34));
class Made34 { a34: number; b34: number; s34: string; constructor(a: number, b: number, s: string) { this.a34 = a; this.b34 = b; this.s34 = s; } }
class Initialized34 { a34 = 1; b34 = 2.5; s34 = "i"; }
class Empty34A { a34!: number; b34!: number; s34!: string; } class Empty34B { b34!: number; a34!: number; s34!: string; } class Empty34C { s34!: string; a34!: number; b34!: number; }
class Holder34 { inner34: R34; z34: number; constructor(inner: R34, z: number) { this.inner34 = inner; this.z34 = z; } }
function make34(k: number): R34 { return { a34: k, b34: k + 2, s34: "f" }; }
function copy34(from: R34, k: number): R34 { return { ...from, b34: k }; }
function fill34(k: number): R34 { const made = {} as R34; made.a34 = k; made.b34 = 1; made.s34 = "l"; return made; }
function rest34({ extra34, ...rest }: R34 & { extra34: number }): R34 { return rest; }
function choose34(k: number): R34 { let made: R34; switch (k & 3) { case 0: made = new Empty34A(); break; case 1: made = new Empty34B(); break; case 2: made = new Empty34C(); break; default: made = new Empty34A(); break; } made.a34 = k; made.b34 = 2; made.s34 = "w"; return made; }
function list34(k: number): number[] { return [k, k + 2, 5]; }
function hold34(k: number): { kept34: R34; rest34: number } { return { kept34: { a34: k, b34: 8, s34: "held" }, rest34: k }; }
const held34 = seen(hold34(7));
function alone34(k: number): R34 { return ((copy34(src34, k)) as R34); }
function through34(k: number): R34 { return alone34(k + 1); }
function c34(k: number): unknown { return { top34: { inner34: ((copy34(src34, k)) as R34), z34: k }, w34: k + 1 }; }
type R35 = { a35: number; b35: number; s35: string };
const src35: R35 = seen({ a35: 1, b35: 2.5, s35: "src" }), other35: R35 = seen({ a35: 3, b35: 4, s35: "other" }), wide35 = seen({ extra35: 9, a35: 5, b35: 6, s35: "wide" }), nums35: number[] = seen([1, 2, 3]);
const text35: string = seen(JSON.stringify(src35));
class Made35 { a35: number; b35: number; s35: string; constructor(a: number, b: number, s: string) { this.a35 = a; this.b35 = b; this.s35 = s; } }
class Initialized35 { a35 = 1; b35 = 2.5; s35 = "i"; }
class Empty35A { a35!: number; b35!: number; s35!: string; } class Empty35B { b35!: number; a35!: number; s35!: string; } class Empty35C { s35!: string; a35!: number; b35!: number; }
class Holder35 { inner35: R35; z35: number; constructor(inner: R35, z: number) { this.inner35 = inner; this.z35 = z; } }
function make35(k: number): R35 { return { a35: k, b35: k + 2, s35: "f" }; }
function copy35(from: R35, k: number): R35 { return { ...from, b35: k }; }
function fill35(k: number): R35 { const made = {} as R35; made.a35 = k; made.b35 = 1; made.s35 = "l"; return made; }
function rest35({ extra35, ...rest }: R35 & { extra35: number }): R35 { return rest; }
function choose35(k: number): R35 { let made: R35; switch (k & 3) { case 0: made = new Empty35A(); break; case 1: made = new Empty35B(); break; case 2: made = new Empty35C(); break; default: made = new Empty35A(); break; } made.a35 = k; made.b35 = 2; made.s35 = "w"; return made; }
function list35(k: number): number[] { return [k, k + 2, 5]; }
function hold35(k: number): { kept35: R35; rest35: number } { return { kept35: { a35: k, b35: 8, s35: "held" }, rest35: k }; }
const held35 = seen(hold35(7));
function alone35(k: number): R35 { return ((copy35(src35, k)) as R35); }
function through35(k: number): R35 { return alone35(k + 1); }
function c35(k: number): unknown { return { inner35: alone35(k), z35: k }; }
type R36 = { a36: number; b36: number; s36: string };
const src36: R36 = seen({ a36: 1, b36: 2.5, s36: "src" }), other36: R36 = seen({ a36: 3, b36: 4, s36: "other" }), wide36 = seen({ extra36: 9, a36: 5, b36: 6, s36: "wide" }), nums36: number[] = seen([1, 2, 3]);
const text36: string = seen(JSON.stringify(src36));
class Made36 { a36: number; b36: number; s36: string; constructor(a: number, b: number, s: string) { this.a36 = a; this.b36 = b; this.s36 = s; } }
class Initialized36 { a36 = 1; b36 = 2.5; s36 = "i"; }
class Empty36A { a36!: number; b36!: number; s36!: string; } class Empty36B { b36!: number; a36!: number; s36!: string; } class Empty36C { s36!: string; a36!: number; b36!: number; }
class Holder36 { inner36: R36; z36: number; constructor(inner: R36, z: number) { this.inner36 = inner; this.z36 = z; } }
function make36(k: number): R36 { return { a36: k, b36: k + 2, s36: "f" }; }
function copy36(from: R36, k: number): R36 { return { ...from, b36: k }; }
function fill36(k: number): R36 { const made = {} as R36; made.a36 = k; made.b36 = 1; made.s36 = "l"; return made; }
function rest36({ extra36, ...rest }: R36 & { extra36: number }): R36 { return rest; }
function choose36(k: number): R36 { let made: R36; switch (k & 3) { case 0: made = new Empty36A(); break; case 1: made = new Empty36B(); break; case 2: made = new Empty36C(); break; default: made = new Empty36A(); break; } made.a36 = k; made.b36 = 2; made.s36 = "w"; return made; }
function list36(k: number): number[] { return [k, k + 2, 5]; }
function hold36(k: number): { kept36: R36; rest36: number } { return { kept36: { a36: k, b36: 8, s36: "held" }, rest36: k }; }
const held36 = seen(hold36(7));
function alone36(k: number): R36 { return ((fill36(k)) as R36); }
function through36(k: number): R36 { return alone36(k + 1); }
function c36(k: number): unknown { return { inner36: ((fill36(k)) as R36), z36: k }; }
type R37 = { a37: number; b37: number; s37: string };
const src37: R37 = seen({ a37: 1, b37: 2.5, s37: "src" }), other37: R37 = seen({ a37: 3, b37: 4, s37: "other" }), wide37 = seen({ extra37: 9, a37: 5, b37: 6, s37: "wide" }), nums37: number[] = seen([1, 2, 3]);
const text37: string = seen(JSON.stringify(src37));
class Made37 { a37: number; b37: number; s37: string; constructor(a: number, b: number, s: string) { this.a37 = a; this.b37 = b; this.s37 = s; } }
class Initialized37 { a37 = 1; b37 = 2.5; s37 = "i"; }
class Empty37A { a37!: number; b37!: number; s37!: string; } class Empty37B { b37!: number; a37!: number; s37!: string; } class Empty37C { s37!: string; a37!: number; b37!: number; }
class Holder37 { inner37: R37; z37: number; constructor(inner: R37, z: number) { this.inner37 = inner; this.z37 = z; } }
function make37(k: number): R37 { return { a37: k, b37: k + 2, s37: "f" }; }
function copy37(from: R37, k: number): R37 { return { ...from, b37: k }; }
function fill37(k: number): R37 { const made = {} as R37; made.a37 = k; made.b37 = 1; made.s37 = "l"; return made; }
function rest37({ extra37, ...rest }: R37 & { extra37: number }): R37 { return rest; }
function choose37(k: number): R37 { let made: R37; switch (k & 3) { case 0: made = new Empty37A(); break; case 1: made = new Empty37B(); break; case 2: made = new Empty37C(); break; default: made = new Empty37A(); break; } made.a37 = k; made.b37 = 2; made.s37 = "w"; return made; }
function list37(k: number): number[] { return [k, k + 2, 5]; }
function hold37(k: number): { kept37: R37; rest37: number } { return { kept37: { a37: k, b37: 8, s37: "held" }, rest37: k }; }
const held37 = seen(hold37(7));
function alone37(k: number): R37 { return ((fill37(k)) as R37); }
function through37(k: number): R37 { return alone37(k + 1); }
function c37(k: number): unknown { return { top37: { inner37: ((fill37(k)) as R37), z37: k }, w37: k + 1 }; }
type R38 = { a38: number; b38: number; s38: string };
const src38: R38 = seen({ a38: 1, b38: 2.5, s38: "src" }), other38: R38 = seen({ a38: 3, b38: 4, s38: "other" }), wide38 = seen({ extra38: 9, a38: 5, b38: 6, s38: "wide" }), nums38: number[] = seen([1, 2, 3]);
const text38: string = seen(JSON.stringify(src38));
class Made38 { a38: number; b38: number; s38: string; constructor(a: number, b: number, s: string) { this.a38 = a; this.b38 = b; this.s38 = s; } }
class Initialized38 { a38 = 1; b38 = 2.5; s38 = "i"; }
class Empty38A { a38!: number; b38!: number; s38!: string; } class Empty38B { b38!: number; a38!: number; s38!: string; } class Empty38C { s38!: string; a38!: number; b38!: number; }
class Holder38 { inner38: R38; z38: number; constructor(inner: R38, z: number) { this.inner38 = inner; this.z38 = z; } }
function make38(k: number): R38 { return { a38: k, b38: k + 2, s38: "f" }; }
function copy38(from: R38, k: number): R38 { return { ...from, b38: k }; }
function fill38(k: number): R38 { const made = {} as R38; made.a38 = k; made.b38 = 1; made.s38 = "l"; return made; }
function rest38({ extra38, ...rest }: R38 & { extra38: number }): R38 { return rest; }
function choose38(k: number): R38 { let made: R38; switch (k & 3) { case 0: made = new Empty38A(); break; case 1: made = new Empty38B(); break; case 2: made = new Empty38C(); break; default: made = new Empty38A(); break; } made.a38 = k; made.b38 = 2; made.s38 = "w"; return made; }
function list38(k: number): number[] { return [k, k + 2, 5]; }
function hold38(k: number): { kept38: R38; rest38: number } { return { kept38: { a38: k, b38: 8, s38: "held" }, rest38: k }; }
const held38 = seen(hold38(7));
function alone38(k: number): R38 { return ((fill38(k)) as R38); }
function through38(k: number): R38 { return alone38(k + 1); }
function c38(k: number): unknown { return { inner38: alone38(k), z38: k }; }
type R39 = { a39: number; b39: number; s39: string };
const src39: R39 = seen({ a39: 1, b39: 2.5, s39: "src" }), other39: R39 = seen({ a39: 3, b39: 4, s39: "other" }), wide39 = seen({ extra39: 9, a39: 5, b39: 6, s39: "wide" }), nums39: number[] = seen([1, 2, 3]);
const text39: string = seen(JSON.stringify(src39));
class Made39 { a39: number; b39: number; s39: string; constructor(a: number, b: number, s: string) { this.a39 = a; this.b39 = b; this.s39 = s; } }
class Initialized39 { a39 = 1; b39 = 2.5; s39 = "i"; }
class Empty39A { a39!: number; b39!: number; s39!: string; } class Empty39B { b39!: number; a39!: number; s39!: string; } class Empty39C { s39!: string; a39!: number; b39!: number; }
class Holder39 { inner39: R39; z39: number; constructor(inner: R39, z: number) { this.inner39 = inner; this.z39 = z; } }
function make39(k: number): R39 { return { a39: k, b39: k + 2, s39: "f" }; }
function copy39(from: R39, k: number): R39 { return { ...from, b39: k }; }
function fill39(k: number): R39 { const made = {} as R39; made.a39 = k; made.b39 = 1; made.s39 = "l"; return made; }
function rest39({ extra39, ...rest }: R39 & { extra39: number }): R39 { return rest; }
function choose39(k: number): R39 { let made: R39; switch (k & 3) { case 0: made = new Empty39A(); break; case 1: made = new Empty39B(); break; case 2: made = new Empty39C(); break; default: made = new Empty39A(); break; } made.a39 = k; made.b39 = 2; made.s39 = "w"; return made; }
function list39(k: number): number[] { return [k, k + 2, 5]; }
function hold39(k: number): { kept39: R39; rest39: number } { return { kept39: { a39: k, b39: 8, s39: "held" }, rest39: k }; }
const held39 = seen(hold39(7));
function alone39(k: number): R39 { return ((Object.assign({}, src39) as R39) as R39); }
function through39(k: number): R39 { return alone39(k + 1); }
function c39(k: number): unknown { return { inner39: ((Object.assign({}, src39) as R39) as R39), z39: k }; }
type R40 = { a40: number; b40: number; s40: string };
const src40: R40 = seen({ a40: 1, b40: 2.5, s40: "src" }), other40: R40 = seen({ a40: 3, b40: 4, s40: "other" }), wide40 = seen({ extra40: 9, a40: 5, b40: 6, s40: "wide" }), nums40: number[] = seen([1, 2, 3]);
const text40: string = seen(JSON.stringify(src40));
class Made40 { a40: number; b40: number; s40: string; constructor(a: number, b: number, s: string) { this.a40 = a; this.b40 = b; this.s40 = s; } }
class Initialized40 { a40 = 1; b40 = 2.5; s40 = "i"; }
class Empty40A { a40!: number; b40!: number; s40!: string; } class Empty40B { b40!: number; a40!: number; s40!: string; } class Empty40C { s40!: string; a40!: number; b40!: number; }
class Holder40 { inner40: R40; z40: number; constructor(inner: R40, z: number) { this.inner40 = inner; this.z40 = z; } }
function make40(k: number): R40 { return { a40: k, b40: k + 2, s40: "f" }; }
function copy40(from: R40, k: number): R40 { return { ...from, b40: k }; }
function fill40(k: number): R40 { const made = {} as R40; made.a40 = k; made.b40 = 1; made.s40 = "l"; return made; }
function rest40({ extra40, ...rest }: R40 & { extra40: number }): R40 { return rest; }
function choose40(k: number): R40 { let made: R40; switch (k & 3) { case 0: made = new Empty40A(); break; case 1: made = new Empty40B(); break; case 2: made = new Empty40C(); break; default: made = new Empty40A(); break; } made.a40 = k; made.b40 = 2; made.s40 = "w"; return made; }
function list40(k: number): number[] { return [k, k + 2, 5]; }
function hold40(k: number): { kept40: R40; rest40: number } { return { kept40: { a40: k, b40: 8, s40: "held" }, rest40: k }; }
const held40 = seen(hold40(7));
function alone40(k: number): R40 { return ((Object.assign({}, src40) as R40) as R40); }
function through40(k: number): R40 { return alone40(k + 1); }
function c40(k: number): unknown { return { top40: { inner40: ((Object.assign({}, src40) as R40) as R40), z40: k }, w40: k + 1 }; }
type R41 = { a41: number; b41: number; s41: string };
const src41: R41 = seen({ a41: 1, b41: 2.5, s41: "src" }), other41: R41 = seen({ a41: 3, b41: 4, s41: "other" }), wide41 = seen({ extra41: 9, a41: 5, b41: 6, s41: "wide" }), nums41: number[] = seen([1, 2, 3]);
const text41: string = seen(JSON.stringify(src41));
class Made41 { a41: number; b41: number; s41: string; constructor(a: number, b: number, s: string) { this.a41 = a; this.b41 = b; this.s41 = s; } }
class Initialized41 { a41 = 1; b41 = 2.5; s41 = "i"; }
class Empty41A { a41!: number; b41!: number; s41!: string; } class Empty41B { b41!: number; a41!: number; s41!: string; } class Empty41C { s41!: string; a41!: number; b41!: number; }
class Holder41 { inner41: R41; z41: number; constructor(inner: R41, z: number) { this.inner41 = inner; this.z41 = z; } }
function make41(k: number): R41 { return { a41: k, b41: k + 2, s41: "f" }; }
function copy41(from: R41, k: number): R41 { return { ...from, b41: k }; }
function fill41(k: number): R41 { const made = {} as R41; made.a41 = k; made.b41 = 1; made.s41 = "l"; return made; }
function rest41({ extra41, ...rest }: R41 & { extra41: number }): R41 { return rest; }
function choose41(k: number): R41 { let made: R41; switch (k & 3) { case 0: made = new Empty41A(); break; case 1: made = new Empty41B(); break; case 2: made = new Empty41C(); break; default: made = new Empty41A(); break; } made.a41 = k; made.b41 = 2; made.s41 = "w"; return made; }
function list41(k: number): number[] { return [k, k + 2, 5]; }
function hold41(k: number): { kept41: R41; rest41: number } { return { kept41: { a41: k, b41: 8, s41: "held" }, rest41: k }; }
const held41 = seen(hold41(7));
function alone41(k: number): R41 { return ((Object.assign({}, src41) as R41) as R41); }
function through41(k: number): R41 { return alone41(k + 1); }
function c41(k: number): unknown { return { inner41: alone41(k), z41: k }; }
type R42 = { a42: number; b42: number; s42: string };
const src42: R42 = seen({ a42: 1, b42: 2.5, s42: "src" }), other42: R42 = seen({ a42: 3, b42: 4, s42: "other" }), wide42 = seen({ extra42: 9, a42: 5, b42: 6, s42: "wide" }), nums42: number[] = seen([1, 2, 3]);
const text42: string = seen(JSON.stringify(src42));
class Made42 { a42: number; b42: number; s42: string; constructor(a: number, b: number, s: string) { this.a42 = a; this.b42 = b; this.s42 = s; } }
class Initialized42 { a42 = 1; b42 = 2.5; s42 = "i"; }
class Empty42A { a42!: number; b42!: number; s42!: string; } class Empty42B { b42!: number; a42!: number; s42!: string; } class Empty42C { s42!: string; a42!: number; b42!: number; }
class Holder42 { inner42: R42; z42: number; constructor(inner: R42, z: number) { this.inner42 = inner; this.z42 = z; } }
function make42(k: number): R42 { return { a42: k, b42: k + 2, s42: "f" }; }
function copy42(from: R42, k: number): R42 { return { ...from, b42: k }; }
function fill42(k: number): R42 { const made = {} as R42; made.a42 = k; made.b42 = 1; made.s42 = "l"; return made; }
function rest42({ extra42, ...rest }: R42 & { extra42: number }): R42 { return rest; }
function choose42(k: number): R42 { let made: R42; switch (k & 3) { case 0: made = new Empty42A(); break; case 1: made = new Empty42B(); break; case 2: made = new Empty42C(); break; default: made = new Empty42A(); break; } made.a42 = k; made.b42 = 2; made.s42 = "w"; return made; }
function list42(k: number): number[] { return [k, k + 2, 5]; }
function hold42(k: number): { kept42: R42; rest42: number } { return { kept42: { a42: k, b42: 8, s42: "held" }, rest42: k }; }
const held42 = seen(hold42(7));
function alone42(k: number): R42 { return ((Object.assign({ a42: 0, b42: 0, s42: "" }, src42)) as R42); }
function through42(k: number): R42 { return alone42(k + 1); }
function c42(k: number): unknown { return { inner42: ((Object.assign({ a42: 0, b42: 0, s42: "" }, src42)) as R42), z42: k }; }
type R43 = { a43: number; b43: number; s43: string };
const src43: R43 = seen({ a43: 1, b43: 2.5, s43: "src" }), other43: R43 = seen({ a43: 3, b43: 4, s43: "other" }), wide43 = seen({ extra43: 9, a43: 5, b43: 6, s43: "wide" }), nums43: number[] = seen([1, 2, 3]);
const text43: string = seen(JSON.stringify(src43));
class Made43 { a43: number; b43: number; s43: string; constructor(a: number, b: number, s: string) { this.a43 = a; this.b43 = b; this.s43 = s; } }
class Initialized43 { a43 = 1; b43 = 2.5; s43 = "i"; }
class Empty43A { a43!: number; b43!: number; s43!: string; } class Empty43B { b43!: number; a43!: number; s43!: string; } class Empty43C { s43!: string; a43!: number; b43!: number; }
class Holder43 { inner43: R43; z43: number; constructor(inner: R43, z: number) { this.inner43 = inner; this.z43 = z; } }
function make43(k: number): R43 { return { a43: k, b43: k + 2, s43: "f" }; }
function copy43(from: R43, k: number): R43 { return { ...from, b43: k }; }
function fill43(k: number): R43 { const made = {} as R43; made.a43 = k; made.b43 = 1; made.s43 = "l"; return made; }
function rest43({ extra43, ...rest }: R43 & { extra43: number }): R43 { return rest; }
function choose43(k: number): R43 { let made: R43; switch (k & 3) { case 0: made = new Empty43A(); break; case 1: made = new Empty43B(); break; case 2: made = new Empty43C(); break; default: made = new Empty43A(); break; } made.a43 = k; made.b43 = 2; made.s43 = "w"; return made; }
function list43(k: number): number[] { return [k, k + 2, 5]; }
function hold43(k: number): { kept43: R43; rest43: number } { return { kept43: { a43: k, b43: 8, s43: "held" }, rest43: k }; }
const held43 = seen(hold43(7));
function alone43(k: number): R43 { return ((Object.assign({ a43: 0, b43: 0, s43: "" }, src43)) as R43); }
function through43(k: number): R43 { return alone43(k + 1); }
function c43(k: number): unknown { return { top43: { inner43: ((Object.assign({ a43: 0, b43: 0, s43: "" }, src43)) as R43), z43: k }, w43: k + 1 }; }
type R44 = { a44: number; b44: number; s44: string };
const src44: R44 = seen({ a44: 1, b44: 2.5, s44: "src" }), other44: R44 = seen({ a44: 3, b44: 4, s44: "other" }), wide44 = seen({ extra44: 9, a44: 5, b44: 6, s44: "wide" }), nums44: number[] = seen([1, 2, 3]);
const text44: string = seen(JSON.stringify(src44));
class Made44 { a44: number; b44: number; s44: string; constructor(a: number, b: number, s: string) { this.a44 = a; this.b44 = b; this.s44 = s; } }
class Initialized44 { a44 = 1; b44 = 2.5; s44 = "i"; }
class Empty44A { a44!: number; b44!: number; s44!: string; } class Empty44B { b44!: number; a44!: number; s44!: string; } class Empty44C { s44!: string; a44!: number; b44!: number; }
class Holder44 { inner44: R44; z44: number; constructor(inner: R44, z: number) { this.inner44 = inner; this.z44 = z; } }
function make44(k: number): R44 { return { a44: k, b44: k + 2, s44: "f" }; }
function copy44(from: R44, k: number): R44 { return { ...from, b44: k }; }
function fill44(k: number): R44 { const made = {} as R44; made.a44 = k; made.b44 = 1; made.s44 = "l"; return made; }
function rest44({ extra44, ...rest }: R44 & { extra44: number }): R44 { return rest; }
function choose44(k: number): R44 { let made: R44; switch (k & 3) { case 0: made = new Empty44A(); break; case 1: made = new Empty44B(); break; case 2: made = new Empty44C(); break; default: made = new Empty44A(); break; } made.a44 = k; made.b44 = 2; made.s44 = "w"; return made; }
function list44(k: number): number[] { return [k, k + 2, 5]; }
function hold44(k: number): { kept44: R44; rest44: number } { return { kept44: { a44: k, b44: 8, s44: "held" }, rest44: k }; }
const held44 = seen(hold44(7));
function alone44(k: number): R44 { return ((Object.assign({ a44: 0, b44: 0, s44: "" }, src44)) as R44); }
function through44(k: number): R44 { return alone44(k + 1); }
function c44(k: number): unknown { return { inner44: alone44(k), z44: k }; }
type R45 = { a45: number; b45: number; s45: string };
const src45: R45 = seen({ a45: 1, b45: 2.5, s45: "src" }), other45: R45 = seen({ a45: 3, b45: 4, s45: "other" }), wide45 = seen({ extra45: 9, a45: 5, b45: 6, s45: "wide" }), nums45: number[] = seen([1, 2, 3]);
const text45: string = seen(JSON.stringify(src45));
class Made45 { a45: number; b45: number; s45: string; constructor(a: number, b: number, s: string) { this.a45 = a; this.b45 = b; this.s45 = s; } }
class Initialized45 { a45 = 1; b45 = 2.5; s45 = "i"; }
class Empty45A { a45!: number; b45!: number; s45!: string; } class Empty45B { b45!: number; a45!: number; s45!: string; } class Empty45C { s45!: string; a45!: number; b45!: number; }
class Holder45 { inner45: R45; z45: number; constructor(inner: R45, z: number) { this.inner45 = inner; this.z45 = z; } }
function make45(k: number): R45 { return { a45: k, b45: k + 2, s45: "f" }; }
function copy45(from: R45, k: number): R45 { return { ...from, b45: k }; }
function fill45(k: number): R45 { const made = {} as R45; made.a45 = k; made.b45 = 1; made.s45 = "l"; return made; }
function rest45({ extra45, ...rest }: R45 & { extra45: number }): R45 { return rest; }
function choose45(k: number): R45 { let made: R45; switch (k & 3) { case 0: made = new Empty45A(); break; case 1: made = new Empty45B(); break; case 2: made = new Empty45C(); break; default: made = new Empty45A(); break; } made.a45 = k; made.b45 = 2; made.s45 = "w"; return made; }
function list45(k: number): number[] { return [k, k + 2, 5]; }
function hold45(k: number): { kept45: R45; rest45: number } { return { kept45: { a45: k, b45: 8, s45: "held" }, rest45: k }; }
const held45 = seen(hold45(7));
function alone45(k: number): R45 { return ((structuredClone(src45)) as R45); }
function through45(k: number): R45 { return alone45(k + 1); }
function c45(k: number): unknown { return { inner45: ((structuredClone(src45)) as R45), z45: k }; }
type R46 = { a46: number; b46: number; s46: string };
const src46: R46 = seen({ a46: 1, b46: 2.5, s46: "src" }), other46: R46 = seen({ a46: 3, b46: 4, s46: "other" }), wide46 = seen({ extra46: 9, a46: 5, b46: 6, s46: "wide" }), nums46: number[] = seen([1, 2, 3]);
const text46: string = seen(JSON.stringify(src46));
class Made46 { a46: number; b46: number; s46: string; constructor(a: number, b: number, s: string) { this.a46 = a; this.b46 = b; this.s46 = s; } }
class Initialized46 { a46 = 1; b46 = 2.5; s46 = "i"; }
class Empty46A { a46!: number; b46!: number; s46!: string; } class Empty46B { b46!: number; a46!: number; s46!: string; } class Empty46C { s46!: string; a46!: number; b46!: number; }
class Holder46 { inner46: R46; z46: number; constructor(inner: R46, z: number) { this.inner46 = inner; this.z46 = z; } }
function make46(k: number): R46 { return { a46: k, b46: k + 2, s46: "f" }; }
function copy46(from: R46, k: number): R46 { return { ...from, b46: k }; }
function fill46(k: number): R46 { const made = {} as R46; made.a46 = k; made.b46 = 1; made.s46 = "l"; return made; }
function rest46({ extra46, ...rest }: R46 & { extra46: number }): R46 { return rest; }
function choose46(k: number): R46 { let made: R46; switch (k & 3) { case 0: made = new Empty46A(); break; case 1: made = new Empty46B(); break; case 2: made = new Empty46C(); break; default: made = new Empty46A(); break; } made.a46 = k; made.b46 = 2; made.s46 = "w"; return made; }
function list46(k: number): number[] { return [k, k + 2, 5]; }
function hold46(k: number): { kept46: R46; rest46: number } { return { kept46: { a46: k, b46: 8, s46: "held" }, rest46: k }; }
const held46 = seen(hold46(7));
function alone46(k: number): R46 { return ((structuredClone(src46)) as R46); }
function through46(k: number): R46 { return alone46(k + 1); }
function c46(k: number): unknown { return { top46: { inner46: ((structuredClone(src46)) as R46), z46: k }, w46: k + 1 }; }
type R47 = { a47: number; b47: number; s47: string };
const src47: R47 = seen({ a47: 1, b47: 2.5, s47: "src" }), other47: R47 = seen({ a47: 3, b47: 4, s47: "other" }), wide47 = seen({ extra47: 9, a47: 5, b47: 6, s47: "wide" }), nums47: number[] = seen([1, 2, 3]);
const text47: string = seen(JSON.stringify(src47));
class Made47 { a47: number; b47: number; s47: string; constructor(a: number, b: number, s: string) { this.a47 = a; this.b47 = b; this.s47 = s; } }
class Initialized47 { a47 = 1; b47 = 2.5; s47 = "i"; }
class Empty47A { a47!: number; b47!: number; s47!: string; } class Empty47B { b47!: number; a47!: number; s47!: string; } class Empty47C { s47!: string; a47!: number; b47!: number; }
class Holder47 { inner47: R47; z47: number; constructor(inner: R47, z: number) { this.inner47 = inner; this.z47 = z; } }
function make47(k: number): R47 { return { a47: k, b47: k + 2, s47: "f" }; }
function copy47(from: R47, k: number): R47 { return { ...from, b47: k }; }
function fill47(k: number): R47 { const made = {} as R47; made.a47 = k; made.b47 = 1; made.s47 = "l"; return made; }
function rest47({ extra47, ...rest }: R47 & { extra47: number }): R47 { return rest; }
function choose47(k: number): R47 { let made: R47; switch (k & 3) { case 0: made = new Empty47A(); break; case 1: made = new Empty47B(); break; case 2: made = new Empty47C(); break; default: made = new Empty47A(); break; } made.a47 = k; made.b47 = 2; made.s47 = "w"; return made; }
function list47(k: number): number[] { return [k, k + 2, 5]; }
function hold47(k: number): { kept47: R47; rest47: number } { return { kept47: { a47: k, b47: 8, s47: "held" }, rest47: k }; }
const held47 = seen(hold47(7));
function alone47(k: number): R47 { return ((structuredClone(src47)) as R47); }
function through47(k: number): R47 { return alone47(k + 1); }
function c47(k: number): unknown { return { inner47: alone47(k), z47: k }; }
type R48 = { a48: number; b48: number; s48: string };
const src48: R48 = seen({ a48: 1, b48: 2.5, s48: "src" }), other48: R48 = seen({ a48: 3, b48: 4, s48: "other" }), wide48 = seen({ extra48: 9, a48: 5, b48: 6, s48: "wide" }), nums48: number[] = seen([1, 2, 3]);
const text48: string = seen(JSON.stringify(src48));
class Made48 { a48: number; b48: number; s48: string; constructor(a: number, b: number, s: string) { this.a48 = a; this.b48 = b; this.s48 = s; } }
class Initialized48 { a48 = 1; b48 = 2.5; s48 = "i"; }
class Empty48A { a48!: number; b48!: number; s48!: string; } class Empty48B { b48!: number; a48!: number; s48!: string; } class Empty48C { s48!: string; a48!: number; b48!: number; }
class Holder48 { inner48: R48; z48: number; constructor(inner: R48, z: number) { this.inner48 = inner; this.z48 = z; } }
function make48(k: number): R48 { return { a48: k, b48: k + 2, s48: "f" }; }
function copy48(from: R48, k: number): R48 { return { ...from, b48: k }; }
function fill48(k: number): R48 { const made = {} as R48; made.a48 = k; made.b48 = 1; made.s48 = "l"; return made; }
function rest48({ extra48, ...rest }: R48 & { extra48: number }): R48 { return rest; }
function choose48(k: number): R48 { let made: R48; switch (k & 3) { case 0: made = new Empty48A(); break; case 1: made = new Empty48B(); break; case 2: made = new Empty48C(); break; default: made = new Empty48A(); break; } made.a48 = k; made.b48 = 2; made.s48 = "w"; return made; }
function list48(k: number): number[] { return [k, k + 2, 5]; }
function hold48(k: number): { kept48: R48; rest48: number } { return { kept48: { a48: k, b48: 8, s48: "held" }, rest48: k }; }
const held48 = seen(hold48(7));
function alone48(k: number): R48 { return ((JSON.parse(text48) as R48) as R48); }
function through48(k: number): R48 { return alone48(k + 1); }
function c48(k: number): unknown { return { inner48: ((JSON.parse(text48) as R48) as R48), z48: k }; }
type R49 = { a49: number; b49: number; s49: string };
const src49: R49 = seen({ a49: 1, b49: 2.5, s49: "src" }), other49: R49 = seen({ a49: 3, b49: 4, s49: "other" }), wide49 = seen({ extra49: 9, a49: 5, b49: 6, s49: "wide" }), nums49: number[] = seen([1, 2, 3]);
const text49: string = seen(JSON.stringify(src49));
class Made49 { a49: number; b49: number; s49: string; constructor(a: number, b: number, s: string) { this.a49 = a; this.b49 = b; this.s49 = s; } }
class Initialized49 { a49 = 1; b49 = 2.5; s49 = "i"; }
class Empty49A { a49!: number; b49!: number; s49!: string; } class Empty49B { b49!: number; a49!: number; s49!: string; } class Empty49C { s49!: string; a49!: number; b49!: number; }
class Holder49 { inner49: R49; z49: number; constructor(inner: R49, z: number) { this.inner49 = inner; this.z49 = z; } }
function make49(k: number): R49 { return { a49: k, b49: k + 2, s49: "f" }; }
function copy49(from: R49, k: number): R49 { return { ...from, b49: k }; }
function fill49(k: number): R49 { const made = {} as R49; made.a49 = k; made.b49 = 1; made.s49 = "l"; return made; }
function rest49({ extra49, ...rest }: R49 & { extra49: number }): R49 { return rest; }
function choose49(k: number): R49 { let made: R49; switch (k & 3) { case 0: made = new Empty49A(); break; case 1: made = new Empty49B(); break; case 2: made = new Empty49C(); break; default: made = new Empty49A(); break; } made.a49 = k; made.b49 = 2; made.s49 = "w"; return made; }
function list49(k: number): number[] { return [k, k + 2, 5]; }
function hold49(k: number): { kept49: R49; rest49: number } { return { kept49: { a49: k, b49: 8, s49: "held" }, rest49: k }; }
const held49 = seen(hold49(7));
function alone49(k: number): R49 { return ((JSON.parse(text49) as R49) as R49); }
function through49(k: number): R49 { return alone49(k + 1); }
function c49(k: number): unknown { return { top49: { inner49: ((JSON.parse(text49) as R49) as R49), z49: k }, w49: k + 1 }; }
type R50 = { a50: number; b50: number; s50: string };
const src50: R50 = seen({ a50: 1, b50: 2.5, s50: "src" }), other50: R50 = seen({ a50: 3, b50: 4, s50: "other" }), wide50 = seen({ extra50: 9, a50: 5, b50: 6, s50: "wide" }), nums50: number[] = seen([1, 2, 3]);
const text50: string = seen(JSON.stringify(src50));
class Made50 { a50: number; b50: number; s50: string; constructor(a: number, b: number, s: string) { this.a50 = a; this.b50 = b; this.s50 = s; } }
class Initialized50 { a50 = 1; b50 = 2.5; s50 = "i"; }
class Empty50A { a50!: number; b50!: number; s50!: string; } class Empty50B { b50!: number; a50!: number; s50!: string; } class Empty50C { s50!: string; a50!: number; b50!: number; }
class Holder50 { inner50: R50; z50: number; constructor(inner: R50, z: number) { this.inner50 = inner; this.z50 = z; } }
function make50(k: number): R50 { return { a50: k, b50: k + 2, s50: "f" }; }
function copy50(from: R50, k: number): R50 { return { ...from, b50: k }; }
function fill50(k: number): R50 { const made = {} as R50; made.a50 = k; made.b50 = 1; made.s50 = "l"; return made; }
function rest50({ extra50, ...rest }: R50 & { extra50: number }): R50 { return rest; }
function choose50(k: number): R50 { let made: R50; switch (k & 3) { case 0: made = new Empty50A(); break; case 1: made = new Empty50B(); break; case 2: made = new Empty50C(); break; default: made = new Empty50A(); break; } made.a50 = k; made.b50 = 2; made.s50 = "w"; return made; }
function list50(k: number): number[] { return [k, k + 2, 5]; }
function hold50(k: number): { kept50: R50; rest50: number } { return { kept50: { a50: k, b50: 8, s50: "held" }, rest50: k }; }
const held50 = seen(hold50(7));
function alone50(k: number): R50 { return ((JSON.parse(text50) as R50) as R50); }
function through50(k: number): R50 { return alone50(k + 1); }
function c50(k: number): unknown { return { inner50: alone50(k), z50: k }; }
type R51 = { a51: number; b51: number; s51: string };
const src51: R51 = seen({ a51: 1, b51: 2.5, s51: "src" }), other51: R51 = seen({ a51: 3, b51: 4, s51: "other" }), wide51 = seen({ extra51: 9, a51: 5, b51: 6, s51: "wide" }), nums51: number[] = seen([1, 2, 3]);
const text51: string = seen(JSON.stringify(src51));
class Made51 { a51: number; b51: number; s51: string; constructor(a: number, b: number, s: string) { this.a51 = a; this.b51 = b; this.s51 = s; } }
class Initialized51 { a51 = 1; b51 = 2.5; s51 = "i"; }
class Empty51A { a51!: number; b51!: number; s51!: string; } class Empty51B { b51!: number; a51!: number; s51!: string; } class Empty51C { s51!: string; a51!: number; b51!: number; }
class Holder51 { inner51: R51; z51: number; constructor(inner: R51, z: number) { this.inner51 = inner; this.z51 = z; } }
function make51(k: number): R51 { return { a51: k, b51: k + 2, s51: "f" }; }
function copy51(from: R51, k: number): R51 { return { ...from, b51: k }; }
function fill51(k: number): R51 { const made = {} as R51; made.a51 = k; made.b51 = 1; made.s51 = "l"; return made; }
function rest51({ extra51, ...rest }: R51 & { extra51: number }): R51 { return rest; }
function choose51(k: number): R51 { let made: R51; switch (k & 3) { case 0: made = new Empty51A(); break; case 1: made = new Empty51B(); break; case 2: made = new Empty51C(); break; default: made = new Empty51A(); break; } made.a51 = k; made.b51 = 2; made.s51 = "w"; return made; }
function list51(k: number): number[] { return [k, k + 2, 5]; }
function hold51(k: number): { kept51: R51; rest51: number } { return { kept51: { a51: k, b51: 8, s51: "held" }, rest51: k }; }
const held51 = seen(hold51(7));
function alone51(k: number): R51 { return ((k & 1 ? { a51: k, b51: 1, s51: "x" } : { a51: k, b51: 2, s51: "y" }) as R51); }
function through51(k: number): R51 { return alone51(k + 1); }
function c51(k: number): unknown { return { inner51: ((k & 1 ? { a51: k, b51: 1, s51: "x" } : { a51: k, b51: 2, s51: "y" }) as R51), z51: k }; }
type R52 = { a52: number; b52: number; s52: string };
const src52: R52 = seen({ a52: 1, b52: 2.5, s52: "src" }), other52: R52 = seen({ a52: 3, b52: 4, s52: "other" }), wide52 = seen({ extra52: 9, a52: 5, b52: 6, s52: "wide" }), nums52: number[] = seen([1, 2, 3]);
const text52: string = seen(JSON.stringify(src52));
class Made52 { a52: number; b52: number; s52: string; constructor(a: number, b: number, s: string) { this.a52 = a; this.b52 = b; this.s52 = s; } }
class Initialized52 { a52 = 1; b52 = 2.5; s52 = "i"; }
class Empty52A { a52!: number; b52!: number; s52!: string; } class Empty52B { b52!: number; a52!: number; s52!: string; } class Empty52C { s52!: string; a52!: number; b52!: number; }
class Holder52 { inner52: R52; z52: number; constructor(inner: R52, z: number) { this.inner52 = inner; this.z52 = z; } }
function make52(k: number): R52 { return { a52: k, b52: k + 2, s52: "f" }; }
function copy52(from: R52, k: number): R52 { return { ...from, b52: k }; }
function fill52(k: number): R52 { const made = {} as R52; made.a52 = k; made.b52 = 1; made.s52 = "l"; return made; }
function rest52({ extra52, ...rest }: R52 & { extra52: number }): R52 { return rest; }
function choose52(k: number): R52 { let made: R52; switch (k & 3) { case 0: made = new Empty52A(); break; case 1: made = new Empty52B(); break; case 2: made = new Empty52C(); break; default: made = new Empty52A(); break; } made.a52 = k; made.b52 = 2; made.s52 = "w"; return made; }
function list52(k: number): number[] { return [k, k + 2, 5]; }
function hold52(k: number): { kept52: R52; rest52: number } { return { kept52: { a52: k, b52: 8, s52: "held" }, rest52: k }; }
const held52 = seen(hold52(7));
function alone52(k: number): R52 { return ((k & 1 ? { a52: k, b52: 1, s52: "x" } : { a52: k, b52: 2, s52: "y" }) as R52); }
function through52(k: number): R52 { return alone52(k + 1); }
function c52(k: number): unknown { return { top52: { inner52: ((k & 1 ? { a52: k, b52: 1, s52: "x" } : { a52: k, b52: 2, s52: "y" }) as R52), z52: k }, w52: k + 1 }; }
type R53 = { a53: number; b53: number; s53: string };
const src53: R53 = seen({ a53: 1, b53: 2.5, s53: "src" }), other53: R53 = seen({ a53: 3, b53: 4, s53: "other" }), wide53 = seen({ extra53: 9, a53: 5, b53: 6, s53: "wide" }), nums53: number[] = seen([1, 2, 3]);
const text53: string = seen(JSON.stringify(src53));
class Made53 { a53: number; b53: number; s53: string; constructor(a: number, b: number, s: string) { this.a53 = a; this.b53 = b; this.s53 = s; } }
class Initialized53 { a53 = 1; b53 = 2.5; s53 = "i"; }
class Empty53A { a53!: number; b53!: number; s53!: string; } class Empty53B { b53!: number; a53!: number; s53!: string; } class Empty53C { s53!: string; a53!: number; b53!: number; }
class Holder53 { inner53: R53; z53: number; constructor(inner: R53, z: number) { this.inner53 = inner; this.z53 = z; } }
function make53(k: number): R53 { return { a53: k, b53: k + 2, s53: "f" }; }
function copy53(from: R53, k: number): R53 { return { ...from, b53: k }; }
function fill53(k: number): R53 { const made = {} as R53; made.a53 = k; made.b53 = 1; made.s53 = "l"; return made; }
function rest53({ extra53, ...rest }: R53 & { extra53: number }): R53 { return rest; }
function choose53(k: number): R53 { let made: R53; switch (k & 3) { case 0: made = new Empty53A(); break; case 1: made = new Empty53B(); break; case 2: made = new Empty53C(); break; default: made = new Empty53A(); break; } made.a53 = k; made.b53 = 2; made.s53 = "w"; return made; }
function list53(k: number): number[] { return [k, k + 2, 5]; }
function hold53(k: number): { kept53: R53; rest53: number } { return { kept53: { a53: k, b53: 8, s53: "held" }, rest53: k }; }
const held53 = seen(hold53(7));
function alone53(k: number): R53 { return ((k & 1 ? { a53: k, b53: 1, s53: "x" } : { a53: k, b53: 2, s53: "y" }) as R53); }
function through53(k: number): R53 { return alone53(k + 1); }
function c53(k: number): unknown { return { inner53: alone53(k), z53: k }; }
type R54 = { a54: number; b54: number; s54: string };
const src54: R54 = seen({ a54: 1, b54: 2.5, s54: "src" }), other54: R54 = seen({ a54: 3, b54: 4, s54: "other" }), wide54 = seen({ extra54: 9, a54: 5, b54: 6, s54: "wide" }), nums54: number[] = seen([1, 2, 3]);
const text54: string = seen(JSON.stringify(src54));
class Made54 { a54: number; b54: number; s54: string; constructor(a: number, b: number, s: string) { this.a54 = a; this.b54 = b; this.s54 = s; } }
class Initialized54 { a54 = 1; b54 = 2.5; s54 = "i"; }
class Empty54A { a54!: number; b54!: number; s54!: string; } class Empty54B { b54!: number; a54!: number; s54!: string; } class Empty54C { s54!: string; a54!: number; b54!: number; }
class Holder54 { inner54: R54; z54: number; constructor(inner: R54, z: number) { this.inner54 = inner; this.z54 = z; } }
function make54(k: number): R54 { return { a54: k, b54: k + 2, s54: "f" }; }
function copy54(from: R54, k: number): R54 { return { ...from, b54: k }; }
function fill54(k: number): R54 { const made = {} as R54; made.a54 = k; made.b54 = 1; made.s54 = "l"; return made; }
function rest54({ extra54, ...rest }: R54 & { extra54: number }): R54 { return rest; }
function choose54(k: number): R54 { let made: R54; switch (k & 3) { case 0: made = new Empty54A(); break; case 1: made = new Empty54B(); break; case 2: made = new Empty54C(); break; default: made = new Empty54A(); break; } made.a54 = k; made.b54 = 2; made.s54 = "w"; return made; }
function list54(k: number): number[] { return [k, k + 2, 5]; }
function hold54(k: number): { kept54: R54; rest54: number } { return { kept54: { a54: k, b54: 8, s54: "held" }, rest54: k }; }
const held54 = seen(hold54(7));
function alone54(k: number): R54 { return ((k & 1 ? { ...src54, a54: k } : { a54: k, b54: 2, s54: "y" }) as R54); }
function through54(k: number): R54 { return alone54(k + 1); }
function c54(k: number): unknown { return { inner54: ((k & 1 ? { ...src54, a54: k } : { a54: k, b54: 2, s54: "y" }) as R54), z54: k }; }
type R55 = { a55: number; b55: number; s55: string };
const src55: R55 = seen({ a55: 1, b55: 2.5, s55: "src" }), other55: R55 = seen({ a55: 3, b55: 4, s55: "other" }), wide55 = seen({ extra55: 9, a55: 5, b55: 6, s55: "wide" }), nums55: number[] = seen([1, 2, 3]);
const text55: string = seen(JSON.stringify(src55));
class Made55 { a55: number; b55: number; s55: string; constructor(a: number, b: number, s: string) { this.a55 = a; this.b55 = b; this.s55 = s; } }
class Initialized55 { a55 = 1; b55 = 2.5; s55 = "i"; }
class Empty55A { a55!: number; b55!: number; s55!: string; } class Empty55B { b55!: number; a55!: number; s55!: string; } class Empty55C { s55!: string; a55!: number; b55!: number; }
class Holder55 { inner55: R55; z55: number; constructor(inner: R55, z: number) { this.inner55 = inner; this.z55 = z; } }
function make55(k: number): R55 { return { a55: k, b55: k + 2, s55: "f" }; }
function copy55(from: R55, k: number): R55 { return { ...from, b55: k }; }
function fill55(k: number): R55 { const made = {} as R55; made.a55 = k; made.b55 = 1; made.s55 = "l"; return made; }
function rest55({ extra55, ...rest }: R55 & { extra55: number }): R55 { return rest; }
function choose55(k: number): R55 { let made: R55; switch (k & 3) { case 0: made = new Empty55A(); break; case 1: made = new Empty55B(); break; case 2: made = new Empty55C(); break; default: made = new Empty55A(); break; } made.a55 = k; made.b55 = 2; made.s55 = "w"; return made; }
function list55(k: number): number[] { return [k, k + 2, 5]; }
function hold55(k: number): { kept55: R55; rest55: number } { return { kept55: { a55: k, b55: 8, s55: "held" }, rest55: k }; }
const held55 = seen(hold55(7));
function alone55(k: number): R55 { return ((k & 1 ? { ...src55, a55: k } : { a55: k, b55: 2, s55: "y" }) as R55); }
function through55(k: number): R55 { return alone55(k + 1); }
function c55(k: number): unknown { return { top55: { inner55: ((k & 1 ? { ...src55, a55: k } : { a55: k, b55: 2, s55: "y" }) as R55), z55: k }, w55: k + 1 }; }
type R56 = { a56: number; b56: number; s56: string };
const src56: R56 = seen({ a56: 1, b56: 2.5, s56: "src" }), other56: R56 = seen({ a56: 3, b56: 4, s56: "other" }), wide56 = seen({ extra56: 9, a56: 5, b56: 6, s56: "wide" }), nums56: number[] = seen([1, 2, 3]);
const text56: string = seen(JSON.stringify(src56));
class Made56 { a56: number; b56: number; s56: string; constructor(a: number, b: number, s: string) { this.a56 = a; this.b56 = b; this.s56 = s; } }
class Initialized56 { a56 = 1; b56 = 2.5; s56 = "i"; }
class Empty56A { a56!: number; b56!: number; s56!: string; } class Empty56B { b56!: number; a56!: number; s56!: string; } class Empty56C { s56!: string; a56!: number; b56!: number; }
class Holder56 { inner56: R56; z56: number; constructor(inner: R56, z: number) { this.inner56 = inner; this.z56 = z; } }
function make56(k: number): R56 { return { a56: k, b56: k + 2, s56: "f" }; }
function copy56(from: R56, k: number): R56 { return { ...from, b56: k }; }
function fill56(k: number): R56 { const made = {} as R56; made.a56 = k; made.b56 = 1; made.s56 = "l"; return made; }
function rest56({ extra56, ...rest }: R56 & { extra56: number }): R56 { return rest; }
function choose56(k: number): R56 { let made: R56; switch (k & 3) { case 0: made = new Empty56A(); break; case 1: made = new Empty56B(); break; case 2: made = new Empty56C(); break; default: made = new Empty56A(); break; } made.a56 = k; made.b56 = 2; made.s56 = "w"; return made; }
function list56(k: number): number[] { return [k, k + 2, 5]; }
function hold56(k: number): { kept56: R56; rest56: number } { return { kept56: { a56: k, b56: 8, s56: "held" }, rest56: k }; }
const held56 = seen(hold56(7));
function alone56(k: number): R56 { return ((k & 1 ? { ...src56, a56: k } : { a56: k, b56: 2, s56: "y" }) as R56); }
function through56(k: number): R56 { return alone56(k + 1); }
function c56(k: number): unknown { return { inner56: alone56(k), z56: k }; }
type R57 = { a57: number; b57: number; s57: string };
const src57: R57 = seen({ a57: 1, b57: 2.5, s57: "src" }), other57: R57 = seen({ a57: 3, b57: 4, s57: "other" }), wide57 = seen({ extra57: 9, a57: 5, b57: 6, s57: "wide" }), nums57: number[] = seen([1, 2, 3]);
const text57: string = seen(JSON.stringify(src57));
class Made57 { a57: number; b57: number; s57: string; constructor(a: number, b: number, s: string) { this.a57 = a; this.b57 = b; this.s57 = s; } }
class Initialized57 { a57 = 1; b57 = 2.5; s57 = "i"; }
class Empty57A { a57!: number; b57!: number; s57!: string; } class Empty57B { b57!: number; a57!: number; s57!: string; } class Empty57C { s57!: string; a57!: number; b57!: number; }
class Holder57 { inner57: R57; z57: number; constructor(inner: R57, z: number) { this.inner57 = inner; this.z57 = z; } }
function make57(k: number): R57 { return { a57: k, b57: k + 2, s57: "f" }; }
function copy57(from: R57, k: number): R57 { return { ...from, b57: k }; }
function fill57(k: number): R57 { const made = {} as R57; made.a57 = k; made.b57 = 1; made.s57 = "l"; return made; }
function rest57({ extra57, ...rest }: R57 & { extra57: number }): R57 { return rest; }
function choose57(k: number): R57 { let made: R57; switch (k & 3) { case 0: made = new Empty57A(); break; case 1: made = new Empty57B(); break; case 2: made = new Empty57C(); break; default: made = new Empty57A(); break; } made.a57 = k; made.b57 = 2; made.s57 = "w"; return made; }
function list57(k: number): number[] { return [k, k + 2, 5]; }
function hold57(k: number): { kept57: R57; rest57: number } { return { kept57: { a57: k, b57: 8, s57: "held" }, rest57: k }; }
const held57 = seen(hold57(7));
function alone57(k: number): R57 { return ((k & 1 ? { ...src57, a57: k } : src57) as R57); }
function through57(k: number): R57 { return alone57(k + 1); }
function c57(k: number): unknown { return { inner57: ((k & 1 ? { ...src57, a57: k } : src57) as R57), z57: k }; }
type R58 = { a58: number; b58: number; s58: string };
const src58: R58 = seen({ a58: 1, b58: 2.5, s58: "src" }), other58: R58 = seen({ a58: 3, b58: 4, s58: "other" }), wide58 = seen({ extra58: 9, a58: 5, b58: 6, s58: "wide" }), nums58: number[] = seen([1, 2, 3]);
const text58: string = seen(JSON.stringify(src58));
class Made58 { a58: number; b58: number; s58: string; constructor(a: number, b: number, s: string) { this.a58 = a; this.b58 = b; this.s58 = s; } }
class Initialized58 { a58 = 1; b58 = 2.5; s58 = "i"; }
class Empty58A { a58!: number; b58!: number; s58!: string; } class Empty58B { b58!: number; a58!: number; s58!: string; } class Empty58C { s58!: string; a58!: number; b58!: number; }
class Holder58 { inner58: R58; z58: number; constructor(inner: R58, z: number) { this.inner58 = inner; this.z58 = z; } }
function make58(k: number): R58 { return { a58: k, b58: k + 2, s58: "f" }; }
function copy58(from: R58, k: number): R58 { return { ...from, b58: k }; }
function fill58(k: number): R58 { const made = {} as R58; made.a58 = k; made.b58 = 1; made.s58 = "l"; return made; }
function rest58({ extra58, ...rest }: R58 & { extra58: number }): R58 { return rest; }
function choose58(k: number): R58 { let made: R58; switch (k & 3) { case 0: made = new Empty58A(); break; case 1: made = new Empty58B(); break; case 2: made = new Empty58C(); break; default: made = new Empty58A(); break; } made.a58 = k; made.b58 = 2; made.s58 = "w"; return made; }
function list58(k: number): number[] { return [k, k + 2, 5]; }
function hold58(k: number): { kept58: R58; rest58: number } { return { kept58: { a58: k, b58: 8, s58: "held" }, rest58: k }; }
const held58 = seen(hold58(7));
function alone58(k: number): R58 { return ((k & 1 ? { ...src58, a58: k } : src58) as R58); }
function through58(k: number): R58 { return alone58(k + 1); }
function c58(k: number): unknown { return { top58: { inner58: ((k & 1 ? { ...src58, a58: k } : src58) as R58), z58: k }, w58: k + 1 }; }
type R59 = { a59: number; b59: number; s59: string };
const src59: R59 = seen({ a59: 1, b59: 2.5, s59: "src" }), other59: R59 = seen({ a59: 3, b59: 4, s59: "other" }), wide59 = seen({ extra59: 9, a59: 5, b59: 6, s59: "wide" }), nums59: number[] = seen([1, 2, 3]);
const text59: string = seen(JSON.stringify(src59));
class Made59 { a59: number; b59: number; s59: string; constructor(a: number, b: number, s: string) { this.a59 = a; this.b59 = b; this.s59 = s; } }
class Initialized59 { a59 = 1; b59 = 2.5; s59 = "i"; }
class Empty59A { a59!: number; b59!: number; s59!: string; } class Empty59B { b59!: number; a59!: number; s59!: string; } class Empty59C { s59!: string; a59!: number; b59!: number; }
class Holder59 { inner59: R59; z59: number; constructor(inner: R59, z: number) { this.inner59 = inner; this.z59 = z; } }
function make59(k: number): R59 { return { a59: k, b59: k + 2, s59: "f" }; }
function copy59(from: R59, k: number): R59 { return { ...from, b59: k }; }
function fill59(k: number): R59 { const made = {} as R59; made.a59 = k; made.b59 = 1; made.s59 = "l"; return made; }
function rest59({ extra59, ...rest }: R59 & { extra59: number }): R59 { return rest; }
function choose59(k: number): R59 { let made: R59; switch (k & 3) { case 0: made = new Empty59A(); break; case 1: made = new Empty59B(); break; case 2: made = new Empty59C(); break; default: made = new Empty59A(); break; } made.a59 = k; made.b59 = 2; made.s59 = "w"; return made; }
function list59(k: number): number[] { return [k, k + 2, 5]; }
function hold59(k: number): { kept59: R59; rest59: number } { return { kept59: { a59: k, b59: 8, s59: "held" }, rest59: k }; }
const held59 = seen(hold59(7));
function alone59(k: number): R59 { return ((k & 1 ? { ...src59, a59: k } : src59) as R59); }
function through59(k: number): R59 { return alone59(k + 1); }
function c59(k: number): unknown { return { inner59: alone59(k), z59: k }; }
type R60 = { a60: number; b60: number; s60: string };
const src60: R60 = seen({ a60: 1, b60: 2.5, s60: "src" }), other60: R60 = seen({ a60: 3, b60: 4, s60: "other" }), wide60 = seen({ extra60: 9, a60: 5, b60: 6, s60: "wide" }), nums60: number[] = seen([1, 2, 3]);
const text60: string = seen(JSON.stringify(src60));
class Made60 { a60: number; b60: number; s60: string; constructor(a: number, b: number, s: string) { this.a60 = a; this.b60 = b; this.s60 = s; } }
class Initialized60 { a60 = 1; b60 = 2.5; s60 = "i"; }
class Empty60A { a60!: number; b60!: number; s60!: string; } class Empty60B { b60!: number; a60!: number; s60!: string; } class Empty60C { s60!: string; a60!: number; b60!: number; }
class Holder60 { inner60: R60; z60: number; constructor(inner: R60, z: number) { this.inner60 = inner; this.z60 = z; } }
function make60(k: number): R60 { return { a60: k, b60: k + 2, s60: "f" }; }
function copy60(from: R60, k: number): R60 { return { ...from, b60: k }; }
function fill60(k: number): R60 { const made = {} as R60; made.a60 = k; made.b60 = 1; made.s60 = "l"; return made; }
function rest60({ extra60, ...rest }: R60 & { extra60: number }): R60 { return rest; }
function choose60(k: number): R60 { let made: R60; switch (k & 3) { case 0: made = new Empty60A(); break; case 1: made = new Empty60B(); break; case 2: made = new Empty60C(); break; default: made = new Empty60A(); break; } made.a60 = k; made.b60 = 2; made.s60 = "w"; return made; }
function list60(k: number): number[] { return [k, k + 2, 5]; }
function hold60(k: number): { kept60: R60; rest60: number } { return { kept60: { a60: k, b60: 8, s60: "held" }, rest60: k }; }
const held60 = seen(hold60(7));
function alone60(k: number): R60 { return ((rest60(wide60)) as R60); }
function through60(k: number): R60 { return alone60(k + 1); }
function c60(k: number): unknown { return { inner60: ((rest60(wide60)) as R60), z60: k }; }
type R61 = { a61: number; b61: number; s61: string };
const src61: R61 = seen({ a61: 1, b61: 2.5, s61: "src" }), other61: R61 = seen({ a61: 3, b61: 4, s61: "other" }), wide61 = seen({ extra61: 9, a61: 5, b61: 6, s61: "wide" }), nums61: number[] = seen([1, 2, 3]);
const text61: string = seen(JSON.stringify(src61));
class Made61 { a61: number; b61: number; s61: string; constructor(a: number, b: number, s: string) { this.a61 = a; this.b61 = b; this.s61 = s; } }
class Initialized61 { a61 = 1; b61 = 2.5; s61 = "i"; }
class Empty61A { a61!: number; b61!: number; s61!: string; } class Empty61B { b61!: number; a61!: number; s61!: string; } class Empty61C { s61!: string; a61!: number; b61!: number; }
class Holder61 { inner61: R61; z61: number; constructor(inner: R61, z: number) { this.inner61 = inner; this.z61 = z; } }
function make61(k: number): R61 { return { a61: k, b61: k + 2, s61: "f" }; }
function copy61(from: R61, k: number): R61 { return { ...from, b61: k }; }
function fill61(k: number): R61 { const made = {} as R61; made.a61 = k; made.b61 = 1; made.s61 = "l"; return made; }
function rest61({ extra61, ...rest }: R61 & { extra61: number }): R61 { return rest; }
function choose61(k: number): R61 { let made: R61; switch (k & 3) { case 0: made = new Empty61A(); break; case 1: made = new Empty61B(); break; case 2: made = new Empty61C(); break; default: made = new Empty61A(); break; } made.a61 = k; made.b61 = 2; made.s61 = "w"; return made; }
function list61(k: number): number[] { return [k, k + 2, 5]; }
function hold61(k: number): { kept61: R61; rest61: number } { return { kept61: { a61: k, b61: 8, s61: "held" }, rest61: k }; }
const held61 = seen(hold61(7));
function alone61(k: number): R61 { return ((rest61(wide61)) as R61); }
function through61(k: number): R61 { return alone61(k + 1); }
function c61(k: number): unknown { return { top61: { inner61: ((rest61(wide61)) as R61), z61: k }, w61: k + 1 }; }
type R62 = { a62: number; b62: number; s62: string };
const src62: R62 = seen({ a62: 1, b62: 2.5, s62: "src" }), other62: R62 = seen({ a62: 3, b62: 4, s62: "other" }), wide62 = seen({ extra62: 9, a62: 5, b62: 6, s62: "wide" }), nums62: number[] = seen([1, 2, 3]);
const text62: string = seen(JSON.stringify(src62));
class Made62 { a62: number; b62: number; s62: string; constructor(a: number, b: number, s: string) { this.a62 = a; this.b62 = b; this.s62 = s; } }
class Initialized62 { a62 = 1; b62 = 2.5; s62 = "i"; }
class Empty62A { a62!: number; b62!: number; s62!: string; } class Empty62B { b62!: number; a62!: number; s62!: string; } class Empty62C { s62!: string; a62!: number; b62!: number; }
class Holder62 { inner62: R62; z62: number; constructor(inner: R62, z: number) { this.inner62 = inner; this.z62 = z; } }
function make62(k: number): R62 { return { a62: k, b62: k + 2, s62: "f" }; }
function copy62(from: R62, k: number): R62 { return { ...from, b62: k }; }
function fill62(k: number): R62 { const made = {} as R62; made.a62 = k; made.b62 = 1; made.s62 = "l"; return made; }
function rest62({ extra62, ...rest }: R62 & { extra62: number }): R62 { return rest; }
function choose62(k: number): R62 { let made: R62; switch (k & 3) { case 0: made = new Empty62A(); break; case 1: made = new Empty62B(); break; case 2: made = new Empty62C(); break; default: made = new Empty62A(); break; } made.a62 = k; made.b62 = 2; made.s62 = "w"; return made; }
function list62(k: number): number[] { return [k, k + 2, 5]; }
function hold62(k: number): { kept62: R62; rest62: number } { return { kept62: { a62: k, b62: 8, s62: "held" }, rest62: k }; }
const held62 = seen(hold62(7));
function alone62(k: number): R62 { return ((rest62(wide62)) as R62); }
function through62(k: number): R62 { return alone62(k + 1); }
function c62(k: number): unknown { return { inner62: alone62(k), z62: k }; }
type R63 = { a63: number; b63: number; s63: string };
const src63: R63 = seen({ a63: 1, b63: 2.5, s63: "src" }), other63: R63 = seen({ a63: 3, b63: 4, s63: "other" }), wide63 = seen({ extra63: 9, a63: 5, b63: 6, s63: "wide" }), nums63: number[] = seen([1, 2, 3]);
const text63: string = seen(JSON.stringify(src63));
class Made63 { a63: number; b63: number; s63: string; constructor(a: number, b: number, s: string) { this.a63 = a; this.b63 = b; this.s63 = s; } }
class Initialized63 { a63 = 1; b63 = 2.5; s63 = "i"; }
class Empty63A { a63!: number; b63!: number; s63!: string; } class Empty63B { b63!: number; a63!: number; s63!: string; } class Empty63C { s63!: string; a63!: number; b63!: number; }
class Holder63 { inner63: R63; z63: number; constructor(inner: R63, z: number) { this.inner63 = inner; this.z63 = z; } }
function make63(k: number): R63 { return { a63: k, b63: k + 2, s63: "f" }; }
function copy63(from: R63, k: number): R63 { return { ...from, b63: k }; }
function fill63(k: number): R63 { const made = {} as R63; made.a63 = k; made.b63 = 1; made.s63 = "l"; return made; }
function rest63({ extra63, ...rest }: R63 & { extra63: number }): R63 { return rest; }
function choose63(k: number): R63 { let made: R63; switch (k & 3) { case 0: made = new Empty63A(); break; case 1: made = new Empty63B(); break; case 2: made = new Empty63C(); break; default: made = new Empty63A(); break; } made.a63 = k; made.b63 = 2; made.s63 = "w"; return made; }
function list63(k: number): number[] { return [k, k + 2, 5]; }
function hold63(k: number): { kept63: R63; rest63: number } { return { kept63: { a63: k, b63: 8, s63: "held" }, rest63: k }; }
const held63 = seen(hold63(7));
function alone63(k: number): R63 { return ((choose63(k)) as R63); }
function through63(k: number): R63 { return alone63(k + 1); }
function c63(k: number): unknown { return { inner63: ((choose63(k)) as R63), z63: k }; }
type R64 = { a64: number; b64: number; s64: string };
const src64: R64 = seen({ a64: 1, b64: 2.5, s64: "src" }), other64: R64 = seen({ a64: 3, b64: 4, s64: "other" }), wide64 = seen({ extra64: 9, a64: 5, b64: 6, s64: "wide" }), nums64: number[] = seen([1, 2, 3]);
const text64: string = seen(JSON.stringify(src64));
class Made64 { a64: number; b64: number; s64: string; constructor(a: number, b: number, s: string) { this.a64 = a; this.b64 = b; this.s64 = s; } }
class Initialized64 { a64 = 1; b64 = 2.5; s64 = "i"; }
class Empty64A { a64!: number; b64!: number; s64!: string; } class Empty64B { b64!: number; a64!: number; s64!: string; } class Empty64C { s64!: string; a64!: number; b64!: number; }
class Holder64 { inner64: R64; z64: number; constructor(inner: R64, z: number) { this.inner64 = inner; this.z64 = z; } }
function make64(k: number): R64 { return { a64: k, b64: k + 2, s64: "f" }; }
function copy64(from: R64, k: number): R64 { return { ...from, b64: k }; }
function fill64(k: number): R64 { const made = {} as R64; made.a64 = k; made.b64 = 1; made.s64 = "l"; return made; }
function rest64({ extra64, ...rest }: R64 & { extra64: number }): R64 { return rest; }
function choose64(k: number): R64 { let made: R64; switch (k & 3) { case 0: made = new Empty64A(); break; case 1: made = new Empty64B(); break; case 2: made = new Empty64C(); break; default: made = new Empty64A(); break; } made.a64 = k; made.b64 = 2; made.s64 = "w"; return made; }
function list64(k: number): number[] { return [k, k + 2, 5]; }
function hold64(k: number): { kept64: R64; rest64: number } { return { kept64: { a64: k, b64: 8, s64: "held" }, rest64: k }; }
const held64 = seen(hold64(7));
function alone64(k: number): R64 { return ((choose64(k)) as R64); }
function through64(k: number): R64 { return alone64(k + 1); }
function c64(k: number): unknown { return { top64: { inner64: ((choose64(k)) as R64), z64: k }, w64: k + 1 }; }
type R65 = { a65: number; b65: number; s65: string };
const src65: R65 = seen({ a65: 1, b65: 2.5, s65: "src" }), other65: R65 = seen({ a65: 3, b65: 4, s65: "other" }), wide65 = seen({ extra65: 9, a65: 5, b65: 6, s65: "wide" }), nums65: number[] = seen([1, 2, 3]);
const text65: string = seen(JSON.stringify(src65));
class Made65 { a65: number; b65: number; s65: string; constructor(a: number, b: number, s: string) { this.a65 = a; this.b65 = b; this.s65 = s; } }
class Initialized65 { a65 = 1; b65 = 2.5; s65 = "i"; }
class Empty65A { a65!: number; b65!: number; s65!: string; } class Empty65B { b65!: number; a65!: number; s65!: string; } class Empty65C { s65!: string; a65!: number; b65!: number; }
class Holder65 { inner65: R65; z65: number; constructor(inner: R65, z: number) { this.inner65 = inner; this.z65 = z; } }
function make65(k: number): R65 { return { a65: k, b65: k + 2, s65: "f" }; }
function copy65(from: R65, k: number): R65 { return { ...from, b65: k }; }
function fill65(k: number): R65 { const made = {} as R65; made.a65 = k; made.b65 = 1; made.s65 = "l"; return made; }
function rest65({ extra65, ...rest }: R65 & { extra65: number }): R65 { return rest; }
function choose65(k: number): R65 { let made: R65; switch (k & 3) { case 0: made = new Empty65A(); break; case 1: made = new Empty65B(); break; case 2: made = new Empty65C(); break; default: made = new Empty65A(); break; } made.a65 = k; made.b65 = 2; made.s65 = "w"; return made; }
function list65(k: number): number[] { return [k, k + 2, 5]; }
function hold65(k: number): { kept65: R65; rest65: number } { return { kept65: { a65: k, b65: 8, s65: "held" }, rest65: k }; }
const held65 = seen(hold65(7));
function alone65(k: number): R65 { return ((choose65(k)) as R65); }
function through65(k: number): R65 { return alone65(k + 1); }
function c65(k: number): unknown { return { inner65: alone65(k), z65: k }; }
type R66 = { a66: number; b66: number; s66: string };
const src66: R66 = seen({ a66: 1, b66: 2.5, s66: "src" }), other66: R66 = seen({ a66: 3, b66: 4, s66: "other" }), wide66 = seen({ extra66: 9, a66: 5, b66: 6, s66: "wide" }), nums66: number[] = seen([1, 2, 3]);
const text66: string = seen(JSON.stringify(src66));
class Made66 { a66: number; b66: number; s66: string; constructor(a: number, b: number, s: string) { this.a66 = a; this.b66 = b; this.s66 = s; } }
class Initialized66 { a66 = 1; b66 = 2.5; s66 = "i"; }
class Empty66A { a66!: number; b66!: number; s66!: string; } class Empty66B { b66!: number; a66!: number; s66!: string; } class Empty66C { s66!: string; a66!: number; b66!: number; }
class Holder66 { inner66: R66; z66: number; constructor(inner: R66, z: number) { this.inner66 = inner; this.z66 = z; } }
function make66(k: number): R66 { return { a66: k, b66: k + 2, s66: "f" }; }
function copy66(from: R66, k: number): R66 { return { ...from, b66: k }; }
function fill66(k: number): R66 { const made = {} as R66; made.a66 = k; made.b66 = 1; made.s66 = "l"; return made; }
function rest66({ extra66, ...rest }: R66 & { extra66: number }): R66 { return rest; }
function choose66(k: number): R66 { let made: R66; switch (k & 3) { case 0: made = new Empty66A(); break; case 1: made = new Empty66B(); break; case 2: made = new Empty66C(); break; default: made = new Empty66A(); break; } made.a66 = k; made.b66 = 2; made.s66 = "w"; return made; }
function list66(k: number): number[] { return [k, k + 2, 5]; }
function hold66(k: number): { kept66: R66; rest66: number } { return { kept66: { a66: k, b66: 8, s66: "held" }, rest66: k }; }
const held66 = seen(hold66(7));
function alone66(k: number): R66 { return ((Object.freeze({ a66: k, b66: 1, s66: "z" })) as R66); }
function through66(k: number): R66 { return alone66(k + 1); }
function c66(k: number): unknown { return { inner66: ((Object.freeze({ a66: k, b66: 1, s66: "z" })) as R66), z66: k }; }
type R67 = { a67: number; b67: number; s67: string };
const src67: R67 = seen({ a67: 1, b67: 2.5, s67: "src" }), other67: R67 = seen({ a67: 3, b67: 4, s67: "other" }), wide67 = seen({ extra67: 9, a67: 5, b67: 6, s67: "wide" }), nums67: number[] = seen([1, 2, 3]);
const text67: string = seen(JSON.stringify(src67));
class Made67 { a67: number; b67: number; s67: string; constructor(a: number, b: number, s: string) { this.a67 = a; this.b67 = b; this.s67 = s; } }
class Initialized67 { a67 = 1; b67 = 2.5; s67 = "i"; }
class Empty67A { a67!: number; b67!: number; s67!: string; } class Empty67B { b67!: number; a67!: number; s67!: string; } class Empty67C { s67!: string; a67!: number; b67!: number; }
class Holder67 { inner67: R67; z67: number; constructor(inner: R67, z: number) { this.inner67 = inner; this.z67 = z; } }
function make67(k: number): R67 { return { a67: k, b67: k + 2, s67: "f" }; }
function copy67(from: R67, k: number): R67 { return { ...from, b67: k }; }
function fill67(k: number): R67 { const made = {} as R67; made.a67 = k; made.b67 = 1; made.s67 = "l"; return made; }
function rest67({ extra67, ...rest }: R67 & { extra67: number }): R67 { return rest; }
function choose67(k: number): R67 { let made: R67; switch (k & 3) { case 0: made = new Empty67A(); break; case 1: made = new Empty67B(); break; case 2: made = new Empty67C(); break; default: made = new Empty67A(); break; } made.a67 = k; made.b67 = 2; made.s67 = "w"; return made; }
function list67(k: number): number[] { return [k, k + 2, 5]; }
function hold67(k: number): { kept67: R67; rest67: number } { return { kept67: { a67: k, b67: 8, s67: "held" }, rest67: k }; }
const held67 = seen(hold67(7));
function alone67(k: number): R67 { return ((Object.freeze({ a67: k, b67: 1, s67: "z" })) as R67); }
function through67(k: number): R67 { return alone67(k + 1); }
function c67(k: number): unknown { return { top67: { inner67: ((Object.freeze({ a67: k, b67: 1, s67: "z" })) as R67), z67: k }, w67: k + 1 }; }
type R68 = { a68: number; b68: number; s68: string };
const src68: R68 = seen({ a68: 1, b68: 2.5, s68: "src" }), other68: R68 = seen({ a68: 3, b68: 4, s68: "other" }), wide68 = seen({ extra68: 9, a68: 5, b68: 6, s68: "wide" }), nums68: number[] = seen([1, 2, 3]);
const text68: string = seen(JSON.stringify(src68));
class Made68 { a68: number; b68: number; s68: string; constructor(a: number, b: number, s: string) { this.a68 = a; this.b68 = b; this.s68 = s; } }
class Initialized68 { a68 = 1; b68 = 2.5; s68 = "i"; }
class Empty68A { a68!: number; b68!: number; s68!: string; } class Empty68B { b68!: number; a68!: number; s68!: string; } class Empty68C { s68!: string; a68!: number; b68!: number; }
class Holder68 { inner68: R68; z68: number; constructor(inner: R68, z: number) { this.inner68 = inner; this.z68 = z; } }
function make68(k: number): R68 { return { a68: k, b68: k + 2, s68: "f" }; }
function copy68(from: R68, k: number): R68 { return { ...from, b68: k }; }
function fill68(k: number): R68 { const made = {} as R68; made.a68 = k; made.b68 = 1; made.s68 = "l"; return made; }
function rest68({ extra68, ...rest }: R68 & { extra68: number }): R68 { return rest; }
function choose68(k: number): R68 { let made: R68; switch (k & 3) { case 0: made = new Empty68A(); break; case 1: made = new Empty68B(); break; case 2: made = new Empty68C(); break; default: made = new Empty68A(); break; } made.a68 = k; made.b68 = 2; made.s68 = "w"; return made; }
function list68(k: number): number[] { return [k, k + 2, 5]; }
function hold68(k: number): { kept68: R68; rest68: number } { return { kept68: { a68: k, b68: 8, s68: "held" }, rest68: k }; }
const held68 = seen(hold68(7));
function alone68(k: number): R68 { return ((Object.freeze({ a68: k, b68: 1, s68: "z" })) as R68); }
function through68(k: number): R68 { return alone68(k + 1); }
function c68(k: number): unknown { return { inner68: alone68(k), z68: k }; }
type R69 = { a69: number; b69: number; s69: string };
const src69: R69 = seen({ a69: 1, b69: 2.5, s69: "src" }), other69: R69 = seen({ a69: 3, b69: 4, s69: "other" }), wide69 = seen({ extra69: 9, a69: 5, b69: 6, s69: "wide" }), nums69: number[] = seen([1, 2, 3]);
const text69: string = seen(JSON.stringify(src69));
class Made69 { a69: number; b69: number; s69: string; constructor(a: number, b: number, s: string) { this.a69 = a; this.b69 = b; this.s69 = s; } }
class Initialized69 { a69 = 1; b69 = 2.5; s69 = "i"; }
class Empty69A { a69!: number; b69!: number; s69!: string; } class Empty69B { b69!: number; a69!: number; s69!: string; } class Empty69C { s69!: string; a69!: number; b69!: number; }
class Holder69 { inner69: R69; z69: number; constructor(inner: R69, z: number) { this.inner69 = inner; this.z69 = z; } }
function make69(k: number): R69 { return { a69: k, b69: k + 2, s69: "f" }; }
function copy69(from: R69, k: number): R69 { return { ...from, b69: k }; }
function fill69(k: number): R69 { const made = {} as R69; made.a69 = k; made.b69 = 1; made.s69 = "l"; return made; }
function rest69({ extra69, ...rest }: R69 & { extra69: number }): R69 { return rest; }
function choose69(k: number): R69 { let made: R69; switch (k & 3) { case 0: made = new Empty69A(); break; case 1: made = new Empty69B(); break; case 2: made = new Empty69C(); break; default: made = new Empty69A(); break; } made.a69 = k; made.b69 = 2; made.s69 = "w"; return made; }
function list69(k: number): number[] { return [k, k + 2, 5]; }
function hold69(k: number): { kept69: R69; rest69: number } { return { kept69: { a69: k, b69: 8, s69: "held" }, rest69: k }; }
const held69 = seen(hold69(7));
function alone69(k: number): R69 { return (({ ...{ ...src69, a69: k }, b69: k }) as R69); }
function through69(k: number): R69 { return alone69(k + 1); }
function c69(k: number): unknown { return { inner69: (({ ...{ ...src69, a69: k }, b69: k }) as R69), z69: k }; }
type R70 = { a70: number; b70: number; s70: string };
const src70: R70 = seen({ a70: 1, b70: 2.5, s70: "src" }), other70: R70 = seen({ a70: 3, b70: 4, s70: "other" }), wide70 = seen({ extra70: 9, a70: 5, b70: 6, s70: "wide" }), nums70: number[] = seen([1, 2, 3]);
const text70: string = seen(JSON.stringify(src70));
class Made70 { a70: number; b70: number; s70: string; constructor(a: number, b: number, s: string) { this.a70 = a; this.b70 = b; this.s70 = s; } }
class Initialized70 { a70 = 1; b70 = 2.5; s70 = "i"; }
class Empty70A { a70!: number; b70!: number; s70!: string; } class Empty70B { b70!: number; a70!: number; s70!: string; } class Empty70C { s70!: string; a70!: number; b70!: number; }
class Holder70 { inner70: R70; z70: number; constructor(inner: R70, z: number) { this.inner70 = inner; this.z70 = z; } }
function make70(k: number): R70 { return { a70: k, b70: k + 2, s70: "f" }; }
function copy70(from: R70, k: number): R70 { return { ...from, b70: k }; }
function fill70(k: number): R70 { const made = {} as R70; made.a70 = k; made.b70 = 1; made.s70 = "l"; return made; }
function rest70({ extra70, ...rest }: R70 & { extra70: number }): R70 { return rest; }
function choose70(k: number): R70 { let made: R70; switch (k & 3) { case 0: made = new Empty70A(); break; case 1: made = new Empty70B(); break; case 2: made = new Empty70C(); break; default: made = new Empty70A(); break; } made.a70 = k; made.b70 = 2; made.s70 = "w"; return made; }
function list70(k: number): number[] { return [k, k + 2, 5]; }
function hold70(k: number): { kept70: R70; rest70: number } { return { kept70: { a70: k, b70: 8, s70: "held" }, rest70: k }; }
const held70 = seen(hold70(7));
function alone70(k: number): R70 { return (({ ...{ ...src70, a70: k }, b70: k }) as R70); }
function through70(k: number): R70 { return alone70(k + 1); }
function c70(k: number): unknown { return { top70: { inner70: (({ ...{ ...src70, a70: k }, b70: k }) as R70), z70: k }, w70: k + 1 }; }
type R71 = { a71: number; b71: number; s71: string };
const src71: R71 = seen({ a71: 1, b71: 2.5, s71: "src" }), other71: R71 = seen({ a71: 3, b71: 4, s71: "other" }), wide71 = seen({ extra71: 9, a71: 5, b71: 6, s71: "wide" }), nums71: number[] = seen([1, 2, 3]);
const text71: string = seen(JSON.stringify(src71));
class Made71 { a71: number; b71: number; s71: string; constructor(a: number, b: number, s: string) { this.a71 = a; this.b71 = b; this.s71 = s; } }
class Initialized71 { a71 = 1; b71 = 2.5; s71 = "i"; }
class Empty71A { a71!: number; b71!: number; s71!: string; } class Empty71B { b71!: number; a71!: number; s71!: string; } class Empty71C { s71!: string; a71!: number; b71!: number; }
class Holder71 { inner71: R71; z71: number; constructor(inner: R71, z: number) { this.inner71 = inner; this.z71 = z; } }
function make71(k: number): R71 { return { a71: k, b71: k + 2, s71: "f" }; }
function copy71(from: R71, k: number): R71 { return { ...from, b71: k }; }
function fill71(k: number): R71 { const made = {} as R71; made.a71 = k; made.b71 = 1; made.s71 = "l"; return made; }
function rest71({ extra71, ...rest }: R71 & { extra71: number }): R71 { return rest; }
function choose71(k: number): R71 { let made: R71; switch (k & 3) { case 0: made = new Empty71A(); break; case 1: made = new Empty71B(); break; case 2: made = new Empty71C(); break; default: made = new Empty71A(); break; } made.a71 = k; made.b71 = 2; made.s71 = "w"; return made; }
function list71(k: number): number[] { return [k, k + 2, 5]; }
function hold71(k: number): { kept71: R71; rest71: number } { return { kept71: { a71: k, b71: 8, s71: "held" }, rest71: k }; }
const held71 = seen(hold71(7));
function alone71(k: number): R71 { return (({ ...{ ...src71, a71: k }, b71: k }) as R71); }
function through71(k: number): R71 { return alone71(k + 1); }
function c71(k: number): unknown { return { inner71: alone71(k), z71: k }; }
type R72 = { a72: number; b72: number; s72: string };
const src72: R72 = seen({ a72: 1, b72: 2.5, s72: "src" }), other72: R72 = seen({ a72: 3, b72: 4, s72: "other" }), wide72 = seen({ extra72: 9, a72: 5, b72: 6, s72: "wide" }), nums72: number[] = seen([1, 2, 3]);
const text72: string = seen(JSON.stringify(src72));
class Made72 { a72: number; b72: number; s72: string; constructor(a: number, b: number, s: string) { this.a72 = a; this.b72 = b; this.s72 = s; } }
class Initialized72 { a72 = 1; b72 = 2.5; s72 = "i"; }
class Empty72A { a72!: number; b72!: number; s72!: string; } class Empty72B { b72!: number; a72!: number; s72!: string; } class Empty72C { s72!: string; a72!: number; b72!: number; }
class Holder72 { inner72: R72; z72: number; constructor(inner: R72, z: number) { this.inner72 = inner; this.z72 = z; } }
function make72(k: number): R72 { return { a72: k, b72: k + 2, s72: "f" }; }
function copy72(from: R72, k: number): R72 { return { ...from, b72: k }; }
function fill72(k: number): R72 { const made = {} as R72; made.a72 = k; made.b72 = 1; made.s72 = "l"; return made; }
function rest72({ extra72, ...rest }: R72 & { extra72: number }): R72 { return rest; }
function choose72(k: number): R72 { let made: R72; switch (k & 3) { case 0: made = new Empty72A(); break; case 1: made = new Empty72B(); break; case 2: made = new Empty72C(); break; default: made = new Empty72A(); break; } made.a72 = k; made.b72 = 2; made.s72 = "w"; return made; }
function list72(k: number): number[] { return [k, k + 2, 5]; }
function hold72(k: number): { kept72: R72; rest72: number } { return { kept72: { a72: k, b72: 8, s72: "held" }, rest72: k }; }
const held72 = seen(hold72(7));
function alone72(k: number): R72 { return (({ ...held72.kept72, a72: k }) as R72); }
function through72(k: number): R72 { return alone72(k + 1); }
function c72(k: number): unknown { return { inner72: (({ ...held72.kept72, a72: k }) as R72), z72: k }; }
type R73 = { a73: number; b73: number; s73: string };
const src73: R73 = seen({ a73: 1, b73: 2.5, s73: "src" }), other73: R73 = seen({ a73: 3, b73: 4, s73: "other" }), wide73 = seen({ extra73: 9, a73: 5, b73: 6, s73: "wide" }), nums73: number[] = seen([1, 2, 3]);
const text73: string = seen(JSON.stringify(src73));
class Made73 { a73: number; b73: number; s73: string; constructor(a: number, b: number, s: string) { this.a73 = a; this.b73 = b; this.s73 = s; } }
class Initialized73 { a73 = 1; b73 = 2.5; s73 = "i"; }
class Empty73A { a73!: number; b73!: number; s73!: string; } class Empty73B { b73!: number; a73!: number; s73!: string; } class Empty73C { s73!: string; a73!: number; b73!: number; }
class Holder73 { inner73: R73; z73: number; constructor(inner: R73, z: number) { this.inner73 = inner; this.z73 = z; } }
function make73(k: number): R73 { return { a73: k, b73: k + 2, s73: "f" }; }
function copy73(from: R73, k: number): R73 { return { ...from, b73: k }; }
function fill73(k: number): R73 { const made = {} as R73; made.a73 = k; made.b73 = 1; made.s73 = "l"; return made; }
function rest73({ extra73, ...rest }: R73 & { extra73: number }): R73 { return rest; }
function choose73(k: number): R73 { let made: R73; switch (k & 3) { case 0: made = new Empty73A(); break; case 1: made = new Empty73B(); break; case 2: made = new Empty73C(); break; default: made = new Empty73A(); break; } made.a73 = k; made.b73 = 2; made.s73 = "w"; return made; }
function list73(k: number): number[] { return [k, k + 2, 5]; }
function hold73(k: number): { kept73: R73; rest73: number } { return { kept73: { a73: k, b73: 8, s73: "held" }, rest73: k }; }
const held73 = seen(hold73(7));
function alone73(k: number): R73 { return (({ ...held73.kept73, a73: k }) as R73); }
function through73(k: number): R73 { return alone73(k + 1); }
function c73(k: number): unknown { return { top73: { inner73: (({ ...held73.kept73, a73: k }) as R73), z73: k }, w73: k + 1 }; }
type R74 = { a74: number; b74: number; s74: string };
const src74: R74 = seen({ a74: 1, b74: 2.5, s74: "src" }), other74: R74 = seen({ a74: 3, b74: 4, s74: "other" }), wide74 = seen({ extra74: 9, a74: 5, b74: 6, s74: "wide" }), nums74: number[] = seen([1, 2, 3]);
const text74: string = seen(JSON.stringify(src74));
class Made74 { a74: number; b74: number; s74: string; constructor(a: number, b: number, s: string) { this.a74 = a; this.b74 = b; this.s74 = s; } }
class Initialized74 { a74 = 1; b74 = 2.5; s74 = "i"; }
class Empty74A { a74!: number; b74!: number; s74!: string; } class Empty74B { b74!: number; a74!: number; s74!: string; } class Empty74C { s74!: string; a74!: number; b74!: number; }
class Holder74 { inner74: R74; z74: number; constructor(inner: R74, z: number) { this.inner74 = inner; this.z74 = z; } }
function make74(k: number): R74 { return { a74: k, b74: k + 2, s74: "f" }; }
function copy74(from: R74, k: number): R74 { return { ...from, b74: k }; }
function fill74(k: number): R74 { const made = {} as R74; made.a74 = k; made.b74 = 1; made.s74 = "l"; return made; }
function rest74({ extra74, ...rest }: R74 & { extra74: number }): R74 { return rest; }
function choose74(k: number): R74 { let made: R74; switch (k & 3) { case 0: made = new Empty74A(); break; case 1: made = new Empty74B(); break; case 2: made = new Empty74C(); break; default: made = new Empty74A(); break; } made.a74 = k; made.b74 = 2; made.s74 = "w"; return made; }
function list74(k: number): number[] { return [k, k + 2, 5]; }
function hold74(k: number): { kept74: R74; rest74: number } { return { kept74: { a74: k, b74: 8, s74: "held" }, rest74: k }; }
const held74 = seen(hold74(7));
function alone74(k: number): R74 { return (({ ...held74.kept74, a74: k }) as R74); }
function through74(k: number): R74 { return alone74(k + 1); }
function c74(k: number): unknown { return { inner74: alone74(k), z74: k }; }
type R75 = { a75: number; b75: number; s75: string };
const src75: R75 = seen({ a75: 1, b75: 2.5, s75: "src" }), other75: R75 = seen({ a75: 3, b75: 4, s75: "other" }), wide75 = seen({ extra75: 9, a75: 5, b75: 6, s75: "wide" }), nums75: number[] = seen([1, 2, 3]);
const text75: string = seen(JSON.stringify(src75));
class Made75 { a75: number; b75: number; s75: string; constructor(a: number, b: number, s: string) { this.a75 = a; this.b75 = b; this.s75 = s; } }
class Initialized75 { a75 = 1; b75 = 2.5; s75 = "i"; }
class Empty75A { a75!: number; b75!: number; s75!: string; } class Empty75B { b75!: number; a75!: number; s75!: string; } class Empty75C { s75!: string; a75!: number; b75!: number; }
class Holder75 { inner75: R75; z75: number; constructor(inner: R75, z: number) { this.inner75 = inner; this.z75 = z; } }
function make75(k: number): R75 { return { a75: k, b75: k + 2, s75: "f" }; }
function copy75(from: R75, k: number): R75 { return { ...from, b75: k }; }
function fill75(k: number): R75 { const made = {} as R75; made.a75 = k; made.b75 = 1; made.s75 = "l"; return made; }
function rest75({ extra75, ...rest }: R75 & { extra75: number }): R75 { return rest; }
function choose75(k: number): R75 { let made: R75; switch (k & 3) { case 0: made = new Empty75A(); break; case 1: made = new Empty75B(); break; case 2: made = new Empty75C(); break; default: made = new Empty75A(); break; } made.a75 = k; made.b75 = 2; made.s75 = "w"; return made; }
function list75(k: number): number[] { return [k, k + 2, 5]; }
function hold75(k: number): { kept75: R75; rest75: number } { return { kept75: { a75: k, b75: 8, s75: "held" }, rest75: k }; }
const held75 = seen(hold75(7));
function alone75(k: number): R75 { return (({ ...hold75(k).kept75 }) as R75); }
function through75(k: number): R75 { return alone75(k + 1); }
function c75(k: number): unknown { return { inner75: (({ ...hold75(k).kept75 }) as R75), z75: k }; }
type R76 = { a76: number; b76: number; s76: string };
const src76: R76 = seen({ a76: 1, b76: 2.5, s76: "src" }), other76: R76 = seen({ a76: 3, b76: 4, s76: "other" }), wide76 = seen({ extra76: 9, a76: 5, b76: 6, s76: "wide" }), nums76: number[] = seen([1, 2, 3]);
const text76: string = seen(JSON.stringify(src76));
class Made76 { a76: number; b76: number; s76: string; constructor(a: number, b: number, s: string) { this.a76 = a; this.b76 = b; this.s76 = s; } }
class Initialized76 { a76 = 1; b76 = 2.5; s76 = "i"; }
class Empty76A { a76!: number; b76!: number; s76!: string; } class Empty76B { b76!: number; a76!: number; s76!: string; } class Empty76C { s76!: string; a76!: number; b76!: number; }
class Holder76 { inner76: R76; z76: number; constructor(inner: R76, z: number) { this.inner76 = inner; this.z76 = z; } }
function make76(k: number): R76 { return { a76: k, b76: k + 2, s76: "f" }; }
function copy76(from: R76, k: number): R76 { return { ...from, b76: k }; }
function fill76(k: number): R76 { const made = {} as R76; made.a76 = k; made.b76 = 1; made.s76 = "l"; return made; }
function rest76({ extra76, ...rest }: R76 & { extra76: number }): R76 { return rest; }
function choose76(k: number): R76 { let made: R76; switch (k & 3) { case 0: made = new Empty76A(); break; case 1: made = new Empty76B(); break; case 2: made = new Empty76C(); break; default: made = new Empty76A(); break; } made.a76 = k; made.b76 = 2; made.s76 = "w"; return made; }
function list76(k: number): number[] { return [k, k + 2, 5]; }
function hold76(k: number): { kept76: R76; rest76: number } { return { kept76: { a76: k, b76: 8, s76: "held" }, rest76: k }; }
const held76 = seen(hold76(7));
function alone76(k: number): R76 { return (({ ...hold76(k).kept76 }) as R76); }
function through76(k: number): R76 { return alone76(k + 1); }
function c76(k: number): unknown { return { top76: { inner76: (({ ...hold76(k).kept76 }) as R76), z76: k }, w76: k + 1 }; }
type R77 = { a77: number; b77: number; s77: string };
const src77: R77 = seen({ a77: 1, b77: 2.5, s77: "src" }), other77: R77 = seen({ a77: 3, b77: 4, s77: "other" }), wide77 = seen({ extra77: 9, a77: 5, b77: 6, s77: "wide" }), nums77: number[] = seen([1, 2, 3]);
const text77: string = seen(JSON.stringify(src77));
class Made77 { a77: number; b77: number; s77: string; constructor(a: number, b: number, s: string) { this.a77 = a; this.b77 = b; this.s77 = s; } }
class Initialized77 { a77 = 1; b77 = 2.5; s77 = "i"; }
class Empty77A { a77!: number; b77!: number; s77!: string; } class Empty77B { b77!: number; a77!: number; s77!: string; } class Empty77C { s77!: string; a77!: number; b77!: number; }
class Holder77 { inner77: R77; z77: number; constructor(inner: R77, z: number) { this.inner77 = inner; this.z77 = z; } }
function make77(k: number): R77 { return { a77: k, b77: k + 2, s77: "f" }; }
function copy77(from: R77, k: number): R77 { return { ...from, b77: k }; }
function fill77(k: number): R77 { const made = {} as R77; made.a77 = k; made.b77 = 1; made.s77 = "l"; return made; }
function rest77({ extra77, ...rest }: R77 & { extra77: number }): R77 { return rest; }
function choose77(k: number): R77 { let made: R77; switch (k & 3) { case 0: made = new Empty77A(); break; case 1: made = new Empty77B(); break; case 2: made = new Empty77C(); break; default: made = new Empty77A(); break; } made.a77 = k; made.b77 = 2; made.s77 = "w"; return made; }
function list77(k: number): number[] { return [k, k + 2, 5]; }
function hold77(k: number): { kept77: R77; rest77: number } { return { kept77: { a77: k, b77: 8, s77: "held" }, rest77: k }; }
const held77 = seen(hold77(7));
function alone77(k: number): R77 { return (({ ...hold77(k).kept77 }) as R77); }
function through77(k: number): R77 { return alone77(k + 1); }
function c77(k: number): unknown { return { inner77: alone77(k), z77: k }; }
type R78 = { a78: number; b78: number; s78: string };
const src78: R78 = seen({ a78: 1, b78: 2.5, s78: "src" }), other78: R78 = seen({ a78: 3, b78: 4, s78: "other" }), wide78 = seen({ extra78: 9, a78: 5, b78: 6, s78: "wide" }), nums78: number[] = seen([1, 2, 3]);
const text78: string = seen(JSON.stringify(src78));
class Made78 { a78: number; b78: number; s78: string; constructor(a: number, b: number, s: string) { this.a78 = a; this.b78 = b; this.s78 = s; } }
class Initialized78 { a78 = 1; b78 = 2.5; s78 = "i"; }
class Empty78A { a78!: number; b78!: number; s78!: string; } class Empty78B { b78!: number; a78!: number; s78!: string; } class Empty78C { s78!: string; a78!: number; b78!: number; }
class Holder78 { inner78: R78; z78: number; constructor(inner: R78, z: number) { this.inner78 = inner; this.z78 = z; } }
function make78(k: number): R78 { return { a78: k, b78: k + 2, s78: "f" }; }
function copy78(from: R78, k: number): R78 { return { ...from, b78: k }; }
function fill78(k: number): R78 { const made = {} as R78; made.a78 = k; made.b78 = 1; made.s78 = "l"; return made; }
function rest78({ extra78, ...rest }: R78 & { extra78: number }): R78 { return rest; }
function choose78(k: number): R78 { let made: R78; switch (k & 3) { case 0: made = new Empty78A(); break; case 1: made = new Empty78B(); break; case 2: made = new Empty78C(); break; default: made = new Empty78A(); break; } made.a78 = k; made.b78 = 2; made.s78 = "w"; return made; }
function list78(k: number): number[] { return [k, k + 2, 5]; }
function hold78(k: number): { kept78: R78; rest78: number } { return { kept78: { a78: k, b78: 8, s78: "held" }, rest78: k }; }
const held78 = seen(hold78(7));
function alone78(k: number): R78 { return ((hold78(k).kept78) as R78); }
function through78(k: number): R78 { return alone78(k + 1); }
function c78(k: number): unknown { return { inner78: ((hold78(k).kept78) as R78), z78: k }; }
type R79 = { a79: number; b79: number; s79: string };
const src79: R79 = seen({ a79: 1, b79: 2.5, s79: "src" }), other79: R79 = seen({ a79: 3, b79: 4, s79: "other" }), wide79 = seen({ extra79: 9, a79: 5, b79: 6, s79: "wide" }), nums79: number[] = seen([1, 2, 3]);
const text79: string = seen(JSON.stringify(src79));
class Made79 { a79: number; b79: number; s79: string; constructor(a: number, b: number, s: string) { this.a79 = a; this.b79 = b; this.s79 = s; } }
class Initialized79 { a79 = 1; b79 = 2.5; s79 = "i"; }
class Empty79A { a79!: number; b79!: number; s79!: string; } class Empty79B { b79!: number; a79!: number; s79!: string; } class Empty79C { s79!: string; a79!: number; b79!: number; }
class Holder79 { inner79: R79; z79: number; constructor(inner: R79, z: number) { this.inner79 = inner; this.z79 = z; } }
function make79(k: number): R79 { return { a79: k, b79: k + 2, s79: "f" }; }
function copy79(from: R79, k: number): R79 { return { ...from, b79: k }; }
function fill79(k: number): R79 { const made = {} as R79; made.a79 = k; made.b79 = 1; made.s79 = "l"; return made; }
function rest79({ extra79, ...rest }: R79 & { extra79: number }): R79 { return rest; }
function choose79(k: number): R79 { let made: R79; switch (k & 3) { case 0: made = new Empty79A(); break; case 1: made = new Empty79B(); break; case 2: made = new Empty79C(); break; default: made = new Empty79A(); break; } made.a79 = k; made.b79 = 2; made.s79 = "w"; return made; }
function list79(k: number): number[] { return [k, k + 2, 5]; }
function hold79(k: number): { kept79: R79; rest79: number } { return { kept79: { a79: k, b79: 8, s79: "held" }, rest79: k }; }
const held79 = seen(hold79(7));
function alone79(k: number): R79 { return ((hold79(k).kept79) as R79); }
function through79(k: number): R79 { return alone79(k + 1); }
function c79(k: number): unknown { return { top79: { inner79: ((hold79(k).kept79) as R79), z79: k }, w79: k + 1 }; }
type R80 = { a80: number; b80: number; s80: string };
const src80: R80 = seen({ a80: 1, b80: 2.5, s80: "src" }), other80: R80 = seen({ a80: 3, b80: 4, s80: "other" }), wide80 = seen({ extra80: 9, a80: 5, b80: 6, s80: "wide" }), nums80: number[] = seen([1, 2, 3]);
const text80: string = seen(JSON.stringify(src80));
class Made80 { a80: number; b80: number; s80: string; constructor(a: number, b: number, s: string) { this.a80 = a; this.b80 = b; this.s80 = s; } }
class Initialized80 { a80 = 1; b80 = 2.5; s80 = "i"; }
class Empty80A { a80!: number; b80!: number; s80!: string; } class Empty80B { b80!: number; a80!: number; s80!: string; } class Empty80C { s80!: string; a80!: number; b80!: number; }
class Holder80 { inner80: R80; z80: number; constructor(inner: R80, z: number) { this.inner80 = inner; this.z80 = z; } }
function make80(k: number): R80 { return { a80: k, b80: k + 2, s80: "f" }; }
function copy80(from: R80, k: number): R80 { return { ...from, b80: k }; }
function fill80(k: number): R80 { const made = {} as R80; made.a80 = k; made.b80 = 1; made.s80 = "l"; return made; }
function rest80({ extra80, ...rest }: R80 & { extra80: number }): R80 { return rest; }
function choose80(k: number): R80 { let made: R80; switch (k & 3) { case 0: made = new Empty80A(); break; case 1: made = new Empty80B(); break; case 2: made = new Empty80C(); break; default: made = new Empty80A(); break; } made.a80 = k; made.b80 = 2; made.s80 = "w"; return made; }
function list80(k: number): number[] { return [k, k + 2, 5]; }
function hold80(k: number): { kept80: R80; rest80: number } { return { kept80: { a80: k, b80: 8, s80: "held" }, rest80: k }; }
const held80 = seen(hold80(7));
function alone80(k: number): R80 { return ((hold80(k).kept80) as R80); }
function through80(k: number): R80 { return alone80(k + 1); }
function c80(k: number): unknown { return { inner80: alone80(k), z80: k }; }
type R81 = { a81: number; b81: number; s81: string };
const src81: R81 = seen({ a81: 1, b81: 2.5, s81: "src" }), other81: R81 = seen({ a81: 3, b81: 4, s81: "other" }), wide81 = seen({ extra81: 9, a81: 5, b81: 6, s81: "wide" }), nums81: number[] = seen([1, 2, 3]);
const text81: string = seen(JSON.stringify(src81));
class Made81 { a81: number; b81: number; s81: string; constructor(a: number, b: number, s: string) { this.a81 = a; this.b81 = b; this.s81 = s; } }
class Initialized81 { a81 = 1; b81 = 2.5; s81 = "i"; }
class Empty81A { a81!: number; b81!: number; s81!: string; } class Empty81B { b81!: number; a81!: number; s81!: string; } class Empty81C { s81!: string; a81!: number; b81!: number; }
class Holder81 { inner81: number[]; z81: number; constructor(inner: number[], z: number) { this.inner81 = inner; this.z81 = z; } }
function make81(k: number): R81 { return { a81: k, b81: k + 2, s81: "f" }; }
function copy81(from: R81, k: number): R81 { return { ...from, b81: k }; }
function fill81(k: number): R81 { const made = {} as R81; made.a81 = k; made.b81 = 1; made.s81 = "l"; return made; }
function rest81({ extra81, ...rest }: R81 & { extra81: number }): R81 { return rest; }
function choose81(k: number): R81 { let made: R81; switch (k & 3) { case 0: made = new Empty81A(); break; case 1: made = new Empty81B(); break; case 2: made = new Empty81C(); break; default: made = new Empty81A(); break; } made.a81 = k; made.b81 = 2; made.s81 = "w"; return made; }
function list81(k: number): number[] { return [k, k + 2, 5]; }
function hold81(k: number): { kept81: R81; rest81: number } { return { kept81: { a81: k, b81: 8, s81: "held" }, rest81: k }; }
const held81 = seen(hold81(7));
function alone81(k: number): number[] { return (([k, k + 1]) as number[]); }
function through81(k: number): number[] { return alone81(k + 1); }
function c81(k: number): unknown { return { inner81: (([k, k + 1]) as number[]), z81: k }; }
type R82 = { a82: number; b82: number; s82: string };
const src82: R82 = seen({ a82: 1, b82: 2.5, s82: "src" }), other82: R82 = seen({ a82: 3, b82: 4, s82: "other" }), wide82 = seen({ extra82: 9, a82: 5, b82: 6, s82: "wide" }), nums82: number[] = seen([1, 2, 3]);
const text82: string = seen(JSON.stringify(src82));
class Made82 { a82: number; b82: number; s82: string; constructor(a: number, b: number, s: string) { this.a82 = a; this.b82 = b; this.s82 = s; } }
class Initialized82 { a82 = 1; b82 = 2.5; s82 = "i"; }
class Empty82A { a82!: number; b82!: number; s82!: string; } class Empty82B { b82!: number; a82!: number; s82!: string; } class Empty82C { s82!: string; a82!: number; b82!: number; }
class Holder82 { inner82: number[]; z82: number; constructor(inner: number[], z: number) { this.inner82 = inner; this.z82 = z; } }
function make82(k: number): R82 { return { a82: k, b82: k + 2, s82: "f" }; }
function copy82(from: R82, k: number): R82 { return { ...from, b82: k }; }
function fill82(k: number): R82 { const made = {} as R82; made.a82 = k; made.b82 = 1; made.s82 = "l"; return made; }
function rest82({ extra82, ...rest }: R82 & { extra82: number }): R82 { return rest; }
function choose82(k: number): R82 { let made: R82; switch (k & 3) { case 0: made = new Empty82A(); break; case 1: made = new Empty82B(); break; case 2: made = new Empty82C(); break; default: made = new Empty82A(); break; } made.a82 = k; made.b82 = 2; made.s82 = "w"; return made; }
function list82(k: number): number[] { return [k, k + 2, 5]; }
function hold82(k: number): { kept82: R82; rest82: number } { return { kept82: { a82: k, b82: 8, s82: "held" }, rest82: k }; }
const held82 = seen(hold82(7));
function alone82(k: number): number[] { return (([k, k + 1]) as number[]); }
function through82(k: number): number[] { return alone82(k + 1); }
function c82(k: number): unknown { return { top82: { inner82: (([k, k + 1]) as number[]), z82: k }, w82: k + 1 }; }
type R83 = { a83: number; b83: number; s83: string };
const src83: R83 = seen({ a83: 1, b83: 2.5, s83: "src" }), other83: R83 = seen({ a83: 3, b83: 4, s83: "other" }), wide83 = seen({ extra83: 9, a83: 5, b83: 6, s83: "wide" }), nums83: number[] = seen([1, 2, 3]);
const text83: string = seen(JSON.stringify(src83));
class Made83 { a83: number; b83: number; s83: string; constructor(a: number, b: number, s: string) { this.a83 = a; this.b83 = b; this.s83 = s; } }
class Initialized83 { a83 = 1; b83 = 2.5; s83 = "i"; }
class Empty83A { a83!: number; b83!: number; s83!: string; } class Empty83B { b83!: number; a83!: number; s83!: string; } class Empty83C { s83!: string; a83!: number; b83!: number; }
class Holder83 { inner83: number[]; z83: number; constructor(inner: number[], z: number) { this.inner83 = inner; this.z83 = z; } }
function make83(k: number): R83 { return { a83: k, b83: k + 2, s83: "f" }; }
function copy83(from: R83, k: number): R83 { return { ...from, b83: k }; }
function fill83(k: number): R83 { const made = {} as R83; made.a83 = k; made.b83 = 1; made.s83 = "l"; return made; }
function rest83({ extra83, ...rest }: R83 & { extra83: number }): R83 { return rest; }
function choose83(k: number): R83 { let made: R83; switch (k & 3) { case 0: made = new Empty83A(); break; case 1: made = new Empty83B(); break; case 2: made = new Empty83C(); break; default: made = new Empty83A(); break; } made.a83 = k; made.b83 = 2; made.s83 = "w"; return made; }
function list83(k: number): number[] { return [k, k + 2, 5]; }
function hold83(k: number): { kept83: R83; rest83: number } { return { kept83: { a83: k, b83: 8, s83: "held" }, rest83: k }; }
const held83 = seen(hold83(7));
function alone83(k: number): number[] { return (([k, k + 1]) as number[]); }
function through83(k: number): number[] { return alone83(k + 1); }
function c83(k: number): unknown { return { inner83: alone83(k), z83: k }; }
type R84 = { a84: number; b84: number; s84: string };
const src84: R84 = seen({ a84: 1, b84: 2.5, s84: "src" }), other84: R84 = seen({ a84: 3, b84: 4, s84: "other" }), wide84 = seen({ extra84: 9, a84: 5, b84: 6, s84: "wide" }), nums84: number[] = seen([1, 2, 3]);
const text84: string = seen(JSON.stringify(src84));
class Made84 { a84: number; b84: number; s84: string; constructor(a: number, b: number, s: string) { this.a84 = a; this.b84 = b; this.s84 = s; } }
class Initialized84 { a84 = 1; b84 = 2.5; s84 = "i"; }
class Empty84A { a84!: number; b84!: number; s84!: string; } class Empty84B { b84!: number; a84!: number; s84!: string; } class Empty84C { s84!: string; a84!: number; b84!: number; }
class Holder84 { inner84: number[]; z84: number; constructor(inner: number[], z: number) { this.inner84 = inner; this.z84 = z; } }
function make84(k: number): R84 { return { a84: k, b84: k + 2, s84: "f" }; }
function copy84(from: R84, k: number): R84 { return { ...from, b84: k }; }
function fill84(k: number): R84 { const made = {} as R84; made.a84 = k; made.b84 = 1; made.s84 = "l"; return made; }
function rest84({ extra84, ...rest }: R84 & { extra84: number }): R84 { return rest; }
function choose84(k: number): R84 { let made: R84; switch (k & 3) { case 0: made = new Empty84A(); break; case 1: made = new Empty84B(); break; case 2: made = new Empty84C(); break; default: made = new Empty84A(); break; } made.a84 = k; made.b84 = 2; made.s84 = "w"; return made; }
function list84(k: number): number[] { return [k, k + 2, 5]; }
function hold84(k: number): { kept84: R84; rest84: number } { return { kept84: { a84: k, b84: 8, s84: "held" }, rest84: k }; }
const held84 = seen(hold84(7));
function alone84(k: number): number[] { return (([k + 0.5, 1.5, k / 4]) as number[]); }
function through84(k: number): number[] { return alone84(k + 1); }
function c84(k: number): unknown { return { inner84: (([k + 0.5, 1.5, k / 4]) as number[]), z84: k }; }
type R85 = { a85: number; b85: number; s85: string };
const src85: R85 = seen({ a85: 1, b85: 2.5, s85: "src" }), other85: R85 = seen({ a85: 3, b85: 4, s85: "other" }), wide85 = seen({ extra85: 9, a85: 5, b85: 6, s85: "wide" }), nums85: number[] = seen([1, 2, 3]);
const text85: string = seen(JSON.stringify(src85));
class Made85 { a85: number; b85: number; s85: string; constructor(a: number, b: number, s: string) { this.a85 = a; this.b85 = b; this.s85 = s; } }
class Initialized85 { a85 = 1; b85 = 2.5; s85 = "i"; }
class Empty85A { a85!: number; b85!: number; s85!: string; } class Empty85B { b85!: number; a85!: number; s85!: string; } class Empty85C { s85!: string; a85!: number; b85!: number; }
class Holder85 { inner85: number[]; z85: number; constructor(inner: number[], z: number) { this.inner85 = inner; this.z85 = z; } }
function make85(k: number): R85 { return { a85: k, b85: k + 2, s85: "f" }; }
function copy85(from: R85, k: number): R85 { return { ...from, b85: k }; }
function fill85(k: number): R85 { const made = {} as R85; made.a85 = k; made.b85 = 1; made.s85 = "l"; return made; }
function rest85({ extra85, ...rest }: R85 & { extra85: number }): R85 { return rest; }
function choose85(k: number): R85 { let made: R85; switch (k & 3) { case 0: made = new Empty85A(); break; case 1: made = new Empty85B(); break; case 2: made = new Empty85C(); break; default: made = new Empty85A(); break; } made.a85 = k; made.b85 = 2; made.s85 = "w"; return made; }
function list85(k: number): number[] { return [k, k + 2, 5]; }
function hold85(k: number): { kept85: R85; rest85: number } { return { kept85: { a85: k, b85: 8, s85: "held" }, rest85: k }; }
const held85 = seen(hold85(7));
function alone85(k: number): number[] { return (([k + 0.5, 1.5, k / 4]) as number[]); }
function through85(k: number): number[] { return alone85(k + 1); }
function c85(k: number): unknown { return { top85: { inner85: (([k + 0.5, 1.5, k / 4]) as number[]), z85: k }, w85: k + 1 }; }
type R86 = { a86: number; b86: number; s86: string };
const src86: R86 = seen({ a86: 1, b86: 2.5, s86: "src" }), other86: R86 = seen({ a86: 3, b86: 4, s86: "other" }), wide86 = seen({ extra86: 9, a86: 5, b86: 6, s86: "wide" }), nums86: number[] = seen([1, 2, 3]);
const text86: string = seen(JSON.stringify(src86));
class Made86 { a86: number; b86: number; s86: string; constructor(a: number, b: number, s: string) { this.a86 = a; this.b86 = b; this.s86 = s; } }
class Initialized86 { a86 = 1; b86 = 2.5; s86 = "i"; }
class Empty86A { a86!: number; b86!: number; s86!: string; } class Empty86B { b86!: number; a86!: number; s86!: string; } class Empty86C { s86!: string; a86!: number; b86!: number; }
class Holder86 { inner86: number[]; z86: number; constructor(inner: number[], z: number) { this.inner86 = inner; this.z86 = z; } }
function make86(k: number): R86 { return { a86: k, b86: k + 2, s86: "f" }; }
function copy86(from: R86, k: number): R86 { return { ...from, b86: k }; }
function fill86(k: number): R86 { const made = {} as R86; made.a86 = k; made.b86 = 1; made.s86 = "l"; return made; }
function rest86({ extra86, ...rest }: R86 & { extra86: number }): R86 { return rest; }
function choose86(k: number): R86 { let made: R86; switch (k & 3) { case 0: made = new Empty86A(); break; case 1: made = new Empty86B(); break; case 2: made = new Empty86C(); break; default: made = new Empty86A(); break; } made.a86 = k; made.b86 = 2; made.s86 = "w"; return made; }
function list86(k: number): number[] { return [k, k + 2, 5]; }
function hold86(k: number): { kept86: R86; rest86: number } { return { kept86: { a86: k, b86: 8, s86: "held" }, rest86: k }; }
const held86 = seen(hold86(7));
function alone86(k: number): number[] { return (([k + 0.5, 1.5, k / 4]) as number[]); }
function through86(k: number): number[] { return alone86(k + 1); }
function c86(k: number): unknown { return { inner86: alone86(k), z86: k }; }
type R87 = { a87: number; b87: number; s87: string };
const src87: R87 = seen({ a87: 1, b87: 2.5, s87: "src" }), other87: R87 = seen({ a87: 3, b87: 4, s87: "other" }), wide87 = seen({ extra87: 9, a87: 5, b87: 6, s87: "wide" }), nums87: number[] = seen([1, 2, 3]);
const text87: string = seen(JSON.stringify(src87));
class Made87 { a87: number; b87: number; s87: string; constructor(a: number, b: number, s: string) { this.a87 = a; this.b87 = b; this.s87 = s; } }
class Initialized87 { a87 = 1; b87 = 2.5; s87 = "i"; }
class Empty87A { a87!: number; b87!: number; s87!: string; } class Empty87B { b87!: number; a87!: number; s87!: string; } class Empty87C { s87!: string; a87!: number; b87!: number; }
class Holder87 { inner87: number[]; z87: number; constructor(inner: number[], z: number) { this.inner87 = inner; this.z87 = z; } }
function make87(k: number): R87 { return { a87: k, b87: k + 2, s87: "f" }; }
function copy87(from: R87, k: number): R87 { return { ...from, b87: k }; }
function fill87(k: number): R87 { const made = {} as R87; made.a87 = k; made.b87 = 1; made.s87 = "l"; return made; }
function rest87({ extra87, ...rest }: R87 & { extra87: number }): R87 { return rest; }
function choose87(k: number): R87 { let made: R87; switch (k & 3) { case 0: made = new Empty87A(); break; case 1: made = new Empty87B(); break; case 2: made = new Empty87C(); break; default: made = new Empty87A(); break; } made.a87 = k; made.b87 = 2; made.s87 = "w"; return made; }
function list87(k: number): number[] { return [k, k + 2, 5]; }
function hold87(k: number): { kept87: R87; rest87: number } { return { kept87: { a87: k, b87: 8, s87: "held" }, rest87: k }; }
const held87 = seen(hold87(7));
function alone87(k: number): number[] { return (([k]) as number[]); }
function through87(k: number): number[] { return alone87(k + 1); }
function c87(k: number): unknown { return { inner87: (([k]) as number[]), z87: k }; }
type R88 = { a88: number; b88: number; s88: string };
const src88: R88 = seen({ a88: 1, b88: 2.5, s88: "src" }), other88: R88 = seen({ a88: 3, b88: 4, s88: "other" }), wide88 = seen({ extra88: 9, a88: 5, b88: 6, s88: "wide" }), nums88: number[] = seen([1, 2, 3]);
const text88: string = seen(JSON.stringify(src88));
class Made88 { a88: number; b88: number; s88: string; constructor(a: number, b: number, s: string) { this.a88 = a; this.b88 = b; this.s88 = s; } }
class Initialized88 { a88 = 1; b88 = 2.5; s88 = "i"; }
class Empty88A { a88!: number; b88!: number; s88!: string; } class Empty88B { b88!: number; a88!: number; s88!: string; } class Empty88C { s88!: string; a88!: number; b88!: number; }
class Holder88 { inner88: number[]; z88: number; constructor(inner: number[], z: number) { this.inner88 = inner; this.z88 = z; } }
function make88(k: number): R88 { return { a88: k, b88: k + 2, s88: "f" }; }
function copy88(from: R88, k: number): R88 { return { ...from, b88: k }; }
function fill88(k: number): R88 { const made = {} as R88; made.a88 = k; made.b88 = 1; made.s88 = "l"; return made; }
function rest88({ extra88, ...rest }: R88 & { extra88: number }): R88 { return rest; }
function choose88(k: number): R88 { let made: R88; switch (k & 3) { case 0: made = new Empty88A(); break; case 1: made = new Empty88B(); break; case 2: made = new Empty88C(); break; default: made = new Empty88A(); break; } made.a88 = k; made.b88 = 2; made.s88 = "w"; return made; }
function list88(k: number): number[] { return [k, k + 2, 5]; }
function hold88(k: number): { kept88: R88; rest88: number } { return { kept88: { a88: k, b88: 8, s88: "held" }, rest88: k }; }
const held88 = seen(hold88(7));
function alone88(k: number): number[] { return (([k]) as number[]); }
function through88(k: number): number[] { return alone88(k + 1); }
function c88(k: number): unknown { return { top88: { inner88: (([k]) as number[]), z88: k }, w88: k + 1 }; }
type R89 = { a89: number; b89: number; s89: string };
const src89: R89 = seen({ a89: 1, b89: 2.5, s89: "src" }), other89: R89 = seen({ a89: 3, b89: 4, s89: "other" }), wide89 = seen({ extra89: 9, a89: 5, b89: 6, s89: "wide" }), nums89: number[] = seen([1, 2, 3]);
const text89: string = seen(JSON.stringify(src89));
class Made89 { a89: number; b89: number; s89: string; constructor(a: number, b: number, s: string) { this.a89 = a; this.b89 = b; this.s89 = s; } }
class Initialized89 { a89 = 1; b89 = 2.5; s89 = "i"; }
class Empty89A { a89!: number; b89!: number; s89!: string; } class Empty89B { b89!: number; a89!: number; s89!: string; } class Empty89C { s89!: string; a89!: number; b89!: number; }
class Holder89 { inner89: number[]; z89: number; constructor(inner: number[], z: number) { this.inner89 = inner; this.z89 = z; } }
function make89(k: number): R89 { return { a89: k, b89: k + 2, s89: "f" }; }
function copy89(from: R89, k: number): R89 { return { ...from, b89: k }; }
function fill89(k: number): R89 { const made = {} as R89; made.a89 = k; made.b89 = 1; made.s89 = "l"; return made; }
function rest89({ extra89, ...rest }: R89 & { extra89: number }): R89 { return rest; }
function choose89(k: number): R89 { let made: R89; switch (k & 3) { case 0: made = new Empty89A(); break; case 1: made = new Empty89B(); break; case 2: made = new Empty89C(); break; default: made = new Empty89A(); break; } made.a89 = k; made.b89 = 2; made.s89 = "w"; return made; }
function list89(k: number): number[] { return [k, k + 2, 5]; }
function hold89(k: number): { kept89: R89; rest89: number } { return { kept89: { a89: k, b89: 8, s89: "held" }, rest89: k }; }
const held89 = seen(hold89(7));
function alone89(k: number): number[] { return (([k]) as number[]); }
function through89(k: number): number[] { return alone89(k + 1); }
function c89(k: number): unknown { return { inner89: alone89(k), z89: k }; }
type R90 = { a90: number; b90: number; s90: string };
const src90: R90 = seen({ a90: 1, b90: 2.5, s90: "src" }), other90: R90 = seen({ a90: 3, b90: 4, s90: "other" }), wide90 = seen({ extra90: 9, a90: 5, b90: 6, s90: "wide" }), nums90: number[] = seen([1, 2, 3]);
const text90: string = seen(JSON.stringify(src90));
class Made90 { a90: number; b90: number; s90: string; constructor(a: number, b: number, s: string) { this.a90 = a; this.b90 = b; this.s90 = s; } }
class Initialized90 { a90 = 1; b90 = 2.5; s90 = "i"; }
class Empty90A { a90!: number; b90!: number; s90!: string; } class Empty90B { b90!: number; a90!: number; s90!: string; } class Empty90C { s90!: string; a90!: number; b90!: number; }
class Holder90 { inner90: number[]; z90: number; constructor(inner: number[], z: number) { this.inner90 = inner; this.z90 = z; } }
function make90(k: number): R90 { return { a90: k, b90: k + 2, s90: "f" }; }
function copy90(from: R90, k: number): R90 { return { ...from, b90: k }; }
function fill90(k: number): R90 { const made = {} as R90; made.a90 = k; made.b90 = 1; made.s90 = "l"; return made; }
function rest90({ extra90, ...rest }: R90 & { extra90: number }): R90 { return rest; }
function choose90(k: number): R90 { let made: R90; switch (k & 3) { case 0: made = new Empty90A(); break; case 1: made = new Empty90B(); break; case 2: made = new Empty90C(); break; default: made = new Empty90A(); break; } made.a90 = k; made.b90 = 2; made.s90 = "w"; return made; }
function list90(k: number): number[] { return [k, k + 2, 5]; }
function hold90(k: number): { kept90: R90; rest90: number } { return { kept90: { a90: k, b90: 8, s90: "held" }, rest90: k }; }
const held90 = seen(hold90(7));
function alone90(k: number): number[] { return (([]) as number[]); }
function through90(k: number): number[] { return alone90(k + 1); }
function c90(k: number): unknown { return { inner90: (([]) as number[]), z90: k }; }
type R91 = { a91: number; b91: number; s91: string };
const src91: R91 = seen({ a91: 1, b91: 2.5, s91: "src" }), other91: R91 = seen({ a91: 3, b91: 4, s91: "other" }), wide91 = seen({ extra91: 9, a91: 5, b91: 6, s91: "wide" }), nums91: number[] = seen([1, 2, 3]);
const text91: string = seen(JSON.stringify(src91));
class Made91 { a91: number; b91: number; s91: string; constructor(a: number, b: number, s: string) { this.a91 = a; this.b91 = b; this.s91 = s; } }
class Initialized91 { a91 = 1; b91 = 2.5; s91 = "i"; }
class Empty91A { a91!: number; b91!: number; s91!: string; } class Empty91B { b91!: number; a91!: number; s91!: string; } class Empty91C { s91!: string; a91!: number; b91!: number; }
class Holder91 { inner91: number[]; z91: number; constructor(inner: number[], z: number) { this.inner91 = inner; this.z91 = z; } }
function make91(k: number): R91 { return { a91: k, b91: k + 2, s91: "f" }; }
function copy91(from: R91, k: number): R91 { return { ...from, b91: k }; }
function fill91(k: number): R91 { const made = {} as R91; made.a91 = k; made.b91 = 1; made.s91 = "l"; return made; }
function rest91({ extra91, ...rest }: R91 & { extra91: number }): R91 { return rest; }
function choose91(k: number): R91 { let made: R91; switch (k & 3) { case 0: made = new Empty91A(); break; case 1: made = new Empty91B(); break; case 2: made = new Empty91C(); break; default: made = new Empty91A(); break; } made.a91 = k; made.b91 = 2; made.s91 = "w"; return made; }
function list91(k: number): number[] { return [k, k + 2, 5]; }
function hold91(k: number): { kept91: R91; rest91: number } { return { kept91: { a91: k, b91: 8, s91: "held" }, rest91: k }; }
const held91 = seen(hold91(7));
function alone91(k: number): number[] { return (([]) as number[]); }
function through91(k: number): number[] { return alone91(k + 1); }
function c91(k: number): unknown { return { top91: { inner91: (([]) as number[]), z91: k }, w91: k + 1 }; }
type R92 = { a92: number; b92: number; s92: string };
const src92: R92 = seen({ a92: 1, b92: 2.5, s92: "src" }), other92: R92 = seen({ a92: 3, b92: 4, s92: "other" }), wide92 = seen({ extra92: 9, a92: 5, b92: 6, s92: "wide" }), nums92: number[] = seen([1, 2, 3]);
const text92: string = seen(JSON.stringify(src92));
class Made92 { a92: number; b92: number; s92: string; constructor(a: number, b: number, s: string) { this.a92 = a; this.b92 = b; this.s92 = s; } }
class Initialized92 { a92 = 1; b92 = 2.5; s92 = "i"; }
class Empty92A { a92!: number; b92!: number; s92!: string; } class Empty92B { b92!: number; a92!: number; s92!: string; } class Empty92C { s92!: string; a92!: number; b92!: number; }
class Holder92 { inner92: number[]; z92: number; constructor(inner: number[], z: number) { this.inner92 = inner; this.z92 = z; } }
function make92(k: number): R92 { return { a92: k, b92: k + 2, s92: "f" }; }
function copy92(from: R92, k: number): R92 { return { ...from, b92: k }; }
function fill92(k: number): R92 { const made = {} as R92; made.a92 = k; made.b92 = 1; made.s92 = "l"; return made; }
function rest92({ extra92, ...rest }: R92 & { extra92: number }): R92 { return rest; }
function choose92(k: number): R92 { let made: R92; switch (k & 3) { case 0: made = new Empty92A(); break; case 1: made = new Empty92B(); break; case 2: made = new Empty92C(); break; default: made = new Empty92A(); break; } made.a92 = k; made.b92 = 2; made.s92 = "w"; return made; }
function list92(k: number): number[] { return [k, k + 2, 5]; }
function hold92(k: number): { kept92: R92; rest92: number } { return { kept92: { a92: k, b92: 8, s92: "held" }, rest92: k }; }
const held92 = seen(hold92(7));
function alone92(k: number): number[] { return (([]) as number[]); }
function through92(k: number): number[] { return alone92(k + 1); }
function c92(k: number): unknown { return { inner92: alone92(k), z92: k }; }
type R93 = { a93: number; b93: number; s93: string };
const src93: R93 = seen({ a93: 1, b93: 2.5, s93: "src" }), other93: R93 = seen({ a93: 3, b93: 4, s93: "other" }), wide93 = seen({ extra93: 9, a93: 5, b93: 6, s93: "wide" }), nums93: number[] = seen([1, 2, 3]);
const text93: string = seen(JSON.stringify(src93));
class Made93 { a93: number; b93: number; s93: string; constructor(a: number, b: number, s: string) { this.a93 = a; this.b93 = b; this.s93 = s; } }
class Initialized93 { a93 = 1; b93 = 2.5; s93 = "i"; }
class Empty93A { a93!: number; b93!: number; s93!: string; } class Empty93B { b93!: number; a93!: number; s93!: string; } class Empty93C { s93!: string; a93!: number; b93!: number; }
class Holder93 { inner93: number[]; z93: number; constructor(inner: number[], z: number) { this.inner93 = inner; this.z93 = z; } }
function make93(k: number): R93 { return { a93: k, b93: k + 2, s93: "f" }; }
function copy93(from: R93, k: number): R93 { return { ...from, b93: k }; }
function fill93(k: number): R93 { const made = {} as R93; made.a93 = k; made.b93 = 1; made.s93 = "l"; return made; }
function rest93({ extra93, ...rest }: R93 & { extra93: number }): R93 { return rest; }
function choose93(k: number): R93 { let made: R93; switch (k & 3) { case 0: made = new Empty93A(); break; case 1: made = new Empty93B(); break; case 2: made = new Empty93C(); break; default: made = new Empty93A(); break; } made.a93 = k; made.b93 = 2; made.s93 = "w"; return made; }
function list93(k: number): number[] { return [k, k + 2, 5]; }
function hold93(k: number): { kept93: R93; rest93: number } { return { kept93: { a93: k, b93: 8, s93: "held" }, rest93: k }; }
const held93 = seen(hold93(7));
function alone93(k: number): number[] { return (([k, 1, 2, 3, 4, 5, 6]) as number[]); }
function through93(k: number): number[] { return alone93(k + 1); }
function c93(k: number): unknown { return { inner93: (([k, 1, 2, 3, 4, 5, 6]) as number[]), z93: k }; }
type R94 = { a94: number; b94: number; s94: string };
const src94: R94 = seen({ a94: 1, b94: 2.5, s94: "src" }), other94: R94 = seen({ a94: 3, b94: 4, s94: "other" }), wide94 = seen({ extra94: 9, a94: 5, b94: 6, s94: "wide" }), nums94: number[] = seen([1, 2, 3]);
const text94: string = seen(JSON.stringify(src94));
class Made94 { a94: number; b94: number; s94: string; constructor(a: number, b: number, s: string) { this.a94 = a; this.b94 = b; this.s94 = s; } }
class Initialized94 { a94 = 1; b94 = 2.5; s94 = "i"; }
class Empty94A { a94!: number; b94!: number; s94!: string; } class Empty94B { b94!: number; a94!: number; s94!: string; } class Empty94C { s94!: string; a94!: number; b94!: number; }
class Holder94 { inner94: number[]; z94: number; constructor(inner: number[], z: number) { this.inner94 = inner; this.z94 = z; } }
function make94(k: number): R94 { return { a94: k, b94: k + 2, s94: "f" }; }
function copy94(from: R94, k: number): R94 { return { ...from, b94: k }; }
function fill94(k: number): R94 { const made = {} as R94; made.a94 = k; made.b94 = 1; made.s94 = "l"; return made; }
function rest94({ extra94, ...rest }: R94 & { extra94: number }): R94 { return rest; }
function choose94(k: number): R94 { let made: R94; switch (k & 3) { case 0: made = new Empty94A(); break; case 1: made = new Empty94B(); break; case 2: made = new Empty94C(); break; default: made = new Empty94A(); break; } made.a94 = k; made.b94 = 2; made.s94 = "w"; return made; }
function list94(k: number): number[] { return [k, k + 2, 5]; }
function hold94(k: number): { kept94: R94; rest94: number } { return { kept94: { a94: k, b94: 8, s94: "held" }, rest94: k }; }
const held94 = seen(hold94(7));
function alone94(k: number): number[] { return (([k, 1, 2, 3, 4, 5, 6]) as number[]); }
function through94(k: number): number[] { return alone94(k + 1); }
function c94(k: number): unknown { return { top94: { inner94: (([k, 1, 2, 3, 4, 5, 6]) as number[]), z94: k }, w94: k + 1 }; }
type R95 = { a95: number; b95: number; s95: string };
const src95: R95 = seen({ a95: 1, b95: 2.5, s95: "src" }), other95: R95 = seen({ a95: 3, b95: 4, s95: "other" }), wide95 = seen({ extra95: 9, a95: 5, b95: 6, s95: "wide" }), nums95: number[] = seen([1, 2, 3]);
const text95: string = seen(JSON.stringify(src95));
class Made95 { a95: number; b95: number; s95: string; constructor(a: number, b: number, s: string) { this.a95 = a; this.b95 = b; this.s95 = s; } }
class Initialized95 { a95 = 1; b95 = 2.5; s95 = "i"; }
class Empty95A { a95!: number; b95!: number; s95!: string; } class Empty95B { b95!: number; a95!: number; s95!: string; } class Empty95C { s95!: string; a95!: number; b95!: number; }
class Holder95 { inner95: number[]; z95: number; constructor(inner: number[], z: number) { this.inner95 = inner; this.z95 = z; } }
function make95(k: number): R95 { return { a95: k, b95: k + 2, s95: "f" }; }
function copy95(from: R95, k: number): R95 { return { ...from, b95: k }; }
function fill95(k: number): R95 { const made = {} as R95; made.a95 = k; made.b95 = 1; made.s95 = "l"; return made; }
function rest95({ extra95, ...rest }: R95 & { extra95: number }): R95 { return rest; }
function choose95(k: number): R95 { let made: R95; switch (k & 3) { case 0: made = new Empty95A(); break; case 1: made = new Empty95B(); break; case 2: made = new Empty95C(); break; default: made = new Empty95A(); break; } made.a95 = k; made.b95 = 2; made.s95 = "w"; return made; }
function list95(k: number): number[] { return [k, k + 2, 5]; }
function hold95(k: number): { kept95: R95; rest95: number } { return { kept95: { a95: k, b95: 8, s95: "held" }, rest95: k }; }
const held95 = seen(hold95(7));
function alone95(k: number): number[] { return (([k, 1, 2, 3, 4, 5, 6]) as number[]); }
function through95(k: number): number[] { return alone95(k + 1); }
function c95(k: number): unknown { return { inner95: alone95(k), z95: k }; }
type R96 = { a96: number; b96: number; s96: string };
const src96: R96 = seen({ a96: 1, b96: 2.5, s96: "src" }), other96: R96 = seen({ a96: 3, b96: 4, s96: "other" }), wide96 = seen({ extra96: 9, a96: 5, b96: 6, s96: "wide" }), nums96: number[] = seen([1, 2, 3]);
const text96: string = seen(JSON.stringify(src96));
class Made96 { a96: number; b96: number; s96: string; constructor(a: number, b: number, s: string) { this.a96 = a; this.b96 = b; this.s96 = s; } }
class Initialized96 { a96 = 1; b96 = 2.5; s96 = "i"; }
class Empty96A { a96!: number; b96!: number; s96!: string; } class Empty96B { b96!: number; a96!: number; s96!: string; } class Empty96C { s96!: string; a96!: number; b96!: number; }
class Holder96 { inner96: number[]; z96: number; constructor(inner: number[], z: number) { this.inner96 = inner; this.z96 = z; } }
function make96(k: number): R96 { return { a96: k, b96: k + 2, s96: "f" }; }
function copy96(from: R96, k: number): R96 { return { ...from, b96: k }; }
function fill96(k: number): R96 { const made = {} as R96; made.a96 = k; made.b96 = 1; made.s96 = "l"; return made; }
function rest96({ extra96, ...rest }: R96 & { extra96: number }): R96 { return rest; }
function choose96(k: number): R96 { let made: R96; switch (k & 3) { case 0: made = new Empty96A(); break; case 1: made = new Empty96B(); break; case 2: made = new Empty96C(); break; default: made = new Empty96A(); break; } made.a96 = k; made.b96 = 2; made.s96 = "w"; return made; }
function list96(k: number): number[] { return [k, k + 2, 5]; }
function hold96(k: number): { kept96: R96; rest96: number } { return { kept96: { a96: k, b96: 8, s96: "held" }, rest96: k }; }
const held96 = seen(hold96(7));
function alone96(k: number): number[] { return (([k, 1, 2, 3, 4, 5, 6, 7]) as number[]); }
function through96(k: number): number[] { return alone96(k + 1); }
function c96(k: number): unknown { return { inner96: (([k, 1, 2, 3, 4, 5, 6, 7]) as number[]), z96: k }; }
type R97 = { a97: number; b97: number; s97: string };
const src97: R97 = seen({ a97: 1, b97: 2.5, s97: "src" }), other97: R97 = seen({ a97: 3, b97: 4, s97: "other" }), wide97 = seen({ extra97: 9, a97: 5, b97: 6, s97: "wide" }), nums97: number[] = seen([1, 2, 3]);
const text97: string = seen(JSON.stringify(src97));
class Made97 { a97: number; b97: number; s97: string; constructor(a: number, b: number, s: string) { this.a97 = a; this.b97 = b; this.s97 = s; } }
class Initialized97 { a97 = 1; b97 = 2.5; s97 = "i"; }
class Empty97A { a97!: number; b97!: number; s97!: string; } class Empty97B { b97!: number; a97!: number; s97!: string; } class Empty97C { s97!: string; a97!: number; b97!: number; }
class Holder97 { inner97: number[]; z97: number; constructor(inner: number[], z: number) { this.inner97 = inner; this.z97 = z; } }
function make97(k: number): R97 { return { a97: k, b97: k + 2, s97: "f" }; }
function copy97(from: R97, k: number): R97 { return { ...from, b97: k }; }
function fill97(k: number): R97 { const made = {} as R97; made.a97 = k; made.b97 = 1; made.s97 = "l"; return made; }
function rest97({ extra97, ...rest }: R97 & { extra97: number }): R97 { return rest; }
function choose97(k: number): R97 { let made: R97; switch (k & 3) { case 0: made = new Empty97A(); break; case 1: made = new Empty97B(); break; case 2: made = new Empty97C(); break; default: made = new Empty97A(); break; } made.a97 = k; made.b97 = 2; made.s97 = "w"; return made; }
function list97(k: number): number[] { return [k, k + 2, 5]; }
function hold97(k: number): { kept97: R97; rest97: number } { return { kept97: { a97: k, b97: 8, s97: "held" }, rest97: k }; }
const held97 = seen(hold97(7));
function alone97(k: number): number[] { return (([k, 1, 2, 3, 4, 5, 6, 7]) as number[]); }
function through97(k: number): number[] { return alone97(k + 1); }
function c97(k: number): unknown { return { top97: { inner97: (([k, 1, 2, 3, 4, 5, 6, 7]) as number[]), z97: k }, w97: k + 1 }; }
type R98 = { a98: number; b98: number; s98: string };
const src98: R98 = seen({ a98: 1, b98: 2.5, s98: "src" }), other98: R98 = seen({ a98: 3, b98: 4, s98: "other" }), wide98 = seen({ extra98: 9, a98: 5, b98: 6, s98: "wide" }), nums98: number[] = seen([1, 2, 3]);
const text98: string = seen(JSON.stringify(src98));
class Made98 { a98: number; b98: number; s98: string; constructor(a: number, b: number, s: string) { this.a98 = a; this.b98 = b; this.s98 = s; } }
class Initialized98 { a98 = 1; b98 = 2.5; s98 = "i"; }
class Empty98A { a98!: number; b98!: number; s98!: string; } class Empty98B { b98!: number; a98!: number; s98!: string; } class Empty98C { s98!: string; a98!: number; b98!: number; }
class Holder98 { inner98: number[]; z98: number; constructor(inner: number[], z: number) { this.inner98 = inner; this.z98 = z; } }
function make98(k: number): R98 { return { a98: k, b98: k + 2, s98: "f" }; }
function copy98(from: R98, k: number): R98 { return { ...from, b98: k }; }
function fill98(k: number): R98 { const made = {} as R98; made.a98 = k; made.b98 = 1; made.s98 = "l"; return made; }
function rest98({ extra98, ...rest }: R98 & { extra98: number }): R98 { return rest; }
function choose98(k: number): R98 { let made: R98; switch (k & 3) { case 0: made = new Empty98A(); break; case 1: made = new Empty98B(); break; case 2: made = new Empty98C(); break; default: made = new Empty98A(); break; } made.a98 = k; made.b98 = 2; made.s98 = "w"; return made; }
function list98(k: number): number[] { return [k, k + 2, 5]; }
function hold98(k: number): { kept98: R98; rest98: number } { return { kept98: { a98: k, b98: 8, s98: "held" }, rest98: k }; }
const held98 = seen(hold98(7));
function alone98(k: number): number[] { return (([k, 1, 2, 3, 4, 5, 6, 7]) as number[]); }
function through98(k: number): number[] { return alone98(k + 1); }
function c98(k: number): unknown { return { inner98: alone98(k), z98: k }; }
type R99 = { a99: number; b99: number; s99: string };
const src99: R99 = seen({ a99: 1, b99: 2.5, s99: "src" }), other99: R99 = seen({ a99: 3, b99: 4, s99: "other" }), wide99 = seen({ extra99: 9, a99: 5, b99: 6, s99: "wide" }), nums99: number[] = seen([1, 2, 3]);
const text99: string = seen(JSON.stringify(src99));
class Made99 { a99: number; b99: number; s99: string; constructor(a: number, b: number, s: string) { this.a99 = a; this.b99 = b; this.s99 = s; } }
class Initialized99 { a99 = 1; b99 = 2.5; s99 = "i"; }
class Empty99A { a99!: number; b99!: number; s99!: string; } class Empty99B { b99!: number; a99!: number; s99!: string; } class Empty99C { s99!: string; a99!: number; b99!: number; }
class Holder99 { inner99: number[]; z99: number; constructor(inner: number[], z: number) { this.inner99 = inner; this.z99 = z; } }
function make99(k: number): R99 { return { a99: k, b99: k + 2, s99: "f" }; }
function copy99(from: R99, k: number): R99 { return { ...from, b99: k }; }
function fill99(k: number): R99 { const made = {} as R99; made.a99 = k; made.b99 = 1; made.s99 = "l"; return made; }
function rest99({ extra99, ...rest }: R99 & { extra99: number }): R99 { return rest; }
function choose99(k: number): R99 { let made: R99; switch (k & 3) { case 0: made = new Empty99A(); break; case 1: made = new Empty99B(); break; case 2: made = new Empty99C(); break; default: made = new Empty99A(); break; } made.a99 = k; made.b99 = 2; made.s99 = "w"; return made; }
function list99(k: number): number[] { return [k, k + 2, 5]; }
function hold99(k: number): { kept99: R99; rest99: number } { return { kept99: { a99: k, b99: 8, s99: "held" }, rest99: k }; }
const held99 = seen(hold99(7));
function alone99(k: number): number[] { return (([...nums99]) as number[]); }
function through99(k: number): number[] { return alone99(k + 1); }
function c99(k: number): unknown { return { inner99: (([...nums99]) as number[]), z99: k }; }
type R100 = { a100: number; b100: number; s100: string };
const src100: R100 = seen({ a100: 1, b100: 2.5, s100: "src" }), other100: R100 = seen({ a100: 3, b100: 4, s100: "other" }), wide100 = seen({ extra100: 9, a100: 5, b100: 6, s100: "wide" }), nums100: number[] = seen([1, 2, 3]);
const text100: string = seen(JSON.stringify(src100));
class Made100 { a100: number; b100: number; s100: string; constructor(a: number, b: number, s: string) { this.a100 = a; this.b100 = b; this.s100 = s; } }
class Initialized100 { a100 = 1; b100 = 2.5; s100 = "i"; }
class Empty100A { a100!: number; b100!: number; s100!: string; } class Empty100B { b100!: number; a100!: number; s100!: string; } class Empty100C { s100!: string; a100!: number; b100!: number; }
class Holder100 { inner100: number[]; z100: number; constructor(inner: number[], z: number) { this.inner100 = inner; this.z100 = z; } }
function make100(k: number): R100 { return { a100: k, b100: k + 2, s100: "f" }; }
function copy100(from: R100, k: number): R100 { return { ...from, b100: k }; }
function fill100(k: number): R100 { const made = {} as R100; made.a100 = k; made.b100 = 1; made.s100 = "l"; return made; }
function rest100({ extra100, ...rest }: R100 & { extra100: number }): R100 { return rest; }
function choose100(k: number): R100 { let made: R100; switch (k & 3) { case 0: made = new Empty100A(); break; case 1: made = new Empty100B(); break; case 2: made = new Empty100C(); break; default: made = new Empty100A(); break; } made.a100 = k; made.b100 = 2; made.s100 = "w"; return made; }
function list100(k: number): number[] { return [k, k + 2, 5]; }
function hold100(k: number): { kept100: R100; rest100: number } { return { kept100: { a100: k, b100: 8, s100: "held" }, rest100: k }; }
const held100 = seen(hold100(7));
function alone100(k: number): number[] { return (([...nums100]) as number[]); }
function through100(k: number): number[] { return alone100(k + 1); }
function c100(k: number): unknown { return { top100: { inner100: (([...nums100]) as number[]), z100: k }, w100: k + 1 }; }
type R101 = { a101: number; b101: number; s101: string };
const src101: R101 = seen({ a101: 1, b101: 2.5, s101: "src" }), other101: R101 = seen({ a101: 3, b101: 4, s101: "other" }), wide101 = seen({ extra101: 9, a101: 5, b101: 6, s101: "wide" }), nums101: number[] = seen([1, 2, 3]);
const text101: string = seen(JSON.stringify(src101));
class Made101 { a101: number; b101: number; s101: string; constructor(a: number, b: number, s: string) { this.a101 = a; this.b101 = b; this.s101 = s; } }
class Initialized101 { a101 = 1; b101 = 2.5; s101 = "i"; }
class Empty101A { a101!: number; b101!: number; s101!: string; } class Empty101B { b101!: number; a101!: number; s101!: string; } class Empty101C { s101!: string; a101!: number; b101!: number; }
class Holder101 { inner101: number[]; z101: number; constructor(inner: number[], z: number) { this.inner101 = inner; this.z101 = z; } }
function make101(k: number): R101 { return { a101: k, b101: k + 2, s101: "f" }; }
function copy101(from: R101, k: number): R101 { return { ...from, b101: k }; }
function fill101(k: number): R101 { const made = {} as R101; made.a101 = k; made.b101 = 1; made.s101 = "l"; return made; }
function rest101({ extra101, ...rest }: R101 & { extra101: number }): R101 { return rest; }
function choose101(k: number): R101 { let made: R101; switch (k & 3) { case 0: made = new Empty101A(); break; case 1: made = new Empty101B(); break; case 2: made = new Empty101C(); break; default: made = new Empty101A(); break; } made.a101 = k; made.b101 = 2; made.s101 = "w"; return made; }
function list101(k: number): number[] { return [k, k + 2, 5]; }
function hold101(k: number): { kept101: R101; rest101: number } { return { kept101: { a101: k, b101: 8, s101: "held" }, rest101: k }; }
const held101 = seen(hold101(7));
function alone101(k: number): number[] { return (([...nums101]) as number[]); }
function through101(k: number): number[] { return alone101(k + 1); }
function c101(k: number): unknown { return { inner101: alone101(k), z101: k }; }
type R102 = { a102: number; b102: number; s102: string };
const src102: R102 = seen({ a102: 1, b102: 2.5, s102: "src" }), other102: R102 = seen({ a102: 3, b102: 4, s102: "other" }), wide102 = seen({ extra102: 9, a102: 5, b102: 6, s102: "wide" }), nums102: number[] = seen([1, 2, 3]);
const text102: string = seen(JSON.stringify(src102));
class Made102 { a102: number; b102: number; s102: string; constructor(a: number, b: number, s: string) { this.a102 = a; this.b102 = b; this.s102 = s; } }
class Initialized102 { a102 = 1; b102 = 2.5; s102 = "i"; }
class Empty102A { a102!: number; b102!: number; s102!: string; } class Empty102B { b102!: number; a102!: number; s102!: string; } class Empty102C { s102!: string; a102!: number; b102!: number; }
class Holder102 { inner102: number[]; z102: number; constructor(inner: number[], z: number) { this.inner102 = inner; this.z102 = z; } }
function make102(k: number): R102 { return { a102: k, b102: k + 2, s102: "f" }; }
function copy102(from: R102, k: number): R102 { return { ...from, b102: k }; }
function fill102(k: number): R102 { const made = {} as R102; made.a102 = k; made.b102 = 1; made.s102 = "l"; return made; }
function rest102({ extra102, ...rest }: R102 & { extra102: number }): R102 { return rest; }
function choose102(k: number): R102 { let made: R102; switch (k & 3) { case 0: made = new Empty102A(); break; case 1: made = new Empty102B(); break; case 2: made = new Empty102C(); break; default: made = new Empty102A(); break; } made.a102 = k; made.b102 = 2; made.s102 = "w"; return made; }
function list102(k: number): number[] { return [k, k + 2, 5]; }
function hold102(k: number): { kept102: R102; rest102: number } { return { kept102: { a102: k, b102: 8, s102: "held" }, rest102: k }; }
const held102 = seen(hold102(7));
function alone102(k: number): number[] { return (([k, ...nums102]) as number[]); }
function through102(k: number): number[] { return alone102(k + 1); }
function c102(k: number): unknown { return { inner102: (([k, ...nums102]) as number[]), z102: k }; }
type R103 = { a103: number; b103: number; s103: string };
const src103: R103 = seen({ a103: 1, b103: 2.5, s103: "src" }), other103: R103 = seen({ a103: 3, b103: 4, s103: "other" }), wide103 = seen({ extra103: 9, a103: 5, b103: 6, s103: "wide" }), nums103: number[] = seen([1, 2, 3]);
const text103: string = seen(JSON.stringify(src103));
class Made103 { a103: number; b103: number; s103: string; constructor(a: number, b: number, s: string) { this.a103 = a; this.b103 = b; this.s103 = s; } }
class Initialized103 { a103 = 1; b103 = 2.5; s103 = "i"; }
class Empty103A { a103!: number; b103!: number; s103!: string; } class Empty103B { b103!: number; a103!: number; s103!: string; } class Empty103C { s103!: string; a103!: number; b103!: number; }
class Holder103 { inner103: number[]; z103: number; constructor(inner: number[], z: number) { this.inner103 = inner; this.z103 = z; } }
function make103(k: number): R103 { return { a103: k, b103: k + 2, s103: "f" }; }
function copy103(from: R103, k: number): R103 { return { ...from, b103: k }; }
function fill103(k: number): R103 { const made = {} as R103; made.a103 = k; made.b103 = 1; made.s103 = "l"; return made; }
function rest103({ extra103, ...rest }: R103 & { extra103: number }): R103 { return rest; }
function choose103(k: number): R103 { let made: R103; switch (k & 3) { case 0: made = new Empty103A(); break; case 1: made = new Empty103B(); break; case 2: made = new Empty103C(); break; default: made = new Empty103A(); break; } made.a103 = k; made.b103 = 2; made.s103 = "w"; return made; }
function list103(k: number): number[] { return [k, k + 2, 5]; }
function hold103(k: number): { kept103: R103; rest103: number } { return { kept103: { a103: k, b103: 8, s103: "held" }, rest103: k }; }
const held103 = seen(hold103(7));
function alone103(k: number): number[] { return (([k, ...nums103]) as number[]); }
function through103(k: number): number[] { return alone103(k + 1); }
function c103(k: number): unknown { return { top103: { inner103: (([k, ...nums103]) as number[]), z103: k }, w103: k + 1 }; }
type R104 = { a104: number; b104: number; s104: string };
const src104: R104 = seen({ a104: 1, b104: 2.5, s104: "src" }), other104: R104 = seen({ a104: 3, b104: 4, s104: "other" }), wide104 = seen({ extra104: 9, a104: 5, b104: 6, s104: "wide" }), nums104: number[] = seen([1, 2, 3]);
const text104: string = seen(JSON.stringify(src104));
class Made104 { a104: number; b104: number; s104: string; constructor(a: number, b: number, s: string) { this.a104 = a; this.b104 = b; this.s104 = s; } }
class Initialized104 { a104 = 1; b104 = 2.5; s104 = "i"; }
class Empty104A { a104!: number; b104!: number; s104!: string; } class Empty104B { b104!: number; a104!: number; s104!: string; } class Empty104C { s104!: string; a104!: number; b104!: number; }
class Holder104 { inner104: number[]; z104: number; constructor(inner: number[], z: number) { this.inner104 = inner; this.z104 = z; } }
function make104(k: number): R104 { return { a104: k, b104: k + 2, s104: "f" }; }
function copy104(from: R104, k: number): R104 { return { ...from, b104: k }; }
function fill104(k: number): R104 { const made = {} as R104; made.a104 = k; made.b104 = 1; made.s104 = "l"; return made; }
function rest104({ extra104, ...rest }: R104 & { extra104: number }): R104 { return rest; }
function choose104(k: number): R104 { let made: R104; switch (k & 3) { case 0: made = new Empty104A(); break; case 1: made = new Empty104B(); break; case 2: made = new Empty104C(); break; default: made = new Empty104A(); break; } made.a104 = k; made.b104 = 2; made.s104 = "w"; return made; }
function list104(k: number): number[] { return [k, k + 2, 5]; }
function hold104(k: number): { kept104: R104; rest104: number } { return { kept104: { a104: k, b104: 8, s104: "held" }, rest104: k }; }
const held104 = seen(hold104(7));
function alone104(k: number): number[] { return (([k, ...nums104]) as number[]); }
function through104(k: number): number[] { return alone104(k + 1); }
function c104(k: number): unknown { return { inner104: alone104(k), z104: k }; }
type R105 = { a105: number; b105: number; s105: string };
const src105: R105 = seen({ a105: 1, b105: 2.5, s105: "src" }), other105: R105 = seen({ a105: 3, b105: 4, s105: "other" }), wide105 = seen({ extra105: 9, a105: 5, b105: 6, s105: "wide" }), nums105: number[] = seen([1, 2, 3]);
const text105: string = seen(JSON.stringify(src105));
class Made105 { a105: number; b105: number; s105: string; constructor(a: number, b: number, s: string) { this.a105 = a; this.b105 = b; this.s105 = s; } }
class Initialized105 { a105 = 1; b105 = 2.5; s105 = "i"; }
class Empty105A { a105!: number; b105!: number; s105!: string; } class Empty105B { b105!: number; a105!: number; s105!: string; } class Empty105C { s105!: string; a105!: number; b105!: number; }
class Holder105 { inner105: number[]; z105: number; constructor(inner: number[], z: number) { this.inner105 = inner; this.z105 = z; } }
function make105(k: number): R105 { return { a105: k, b105: k + 2, s105: "f" }; }
function copy105(from: R105, k: number): R105 { return { ...from, b105: k }; }
function fill105(k: number): R105 { const made = {} as R105; made.a105 = k; made.b105 = 1; made.s105 = "l"; return made; }
function rest105({ extra105, ...rest }: R105 & { extra105: number }): R105 { return rest; }
function choose105(k: number): R105 { let made: R105; switch (k & 3) { case 0: made = new Empty105A(); break; case 1: made = new Empty105B(); break; case 2: made = new Empty105C(); break; default: made = new Empty105A(); break; } made.a105 = k; made.b105 = 2; made.s105 = "w"; return made; }
function list105(k: number): number[] { return [k, k + 2, 5]; }
function hold105(k: number): { kept105: R105; rest105: number } { return { kept105: { a105: k, b105: 8, s105: "held" }, rest105: k }; }
const held105 = seen(hold105(7));
function alone105(k: number): number[] { return ((nums105.slice()) as number[]); }
function through105(k: number): number[] { return alone105(k + 1); }
function c105(k: number): unknown { return { inner105: ((nums105.slice()) as number[]), z105: k }; }
type R106 = { a106: number; b106: number; s106: string };
const src106: R106 = seen({ a106: 1, b106: 2.5, s106: "src" }), other106: R106 = seen({ a106: 3, b106: 4, s106: "other" }), wide106 = seen({ extra106: 9, a106: 5, b106: 6, s106: "wide" }), nums106: number[] = seen([1, 2, 3]);
const text106: string = seen(JSON.stringify(src106));
class Made106 { a106: number; b106: number; s106: string; constructor(a: number, b: number, s: string) { this.a106 = a; this.b106 = b; this.s106 = s; } }
class Initialized106 { a106 = 1; b106 = 2.5; s106 = "i"; }
class Empty106A { a106!: number; b106!: number; s106!: string; } class Empty106B { b106!: number; a106!: number; s106!: string; } class Empty106C { s106!: string; a106!: number; b106!: number; }
class Holder106 { inner106: number[]; z106: number; constructor(inner: number[], z: number) { this.inner106 = inner; this.z106 = z; } }
function make106(k: number): R106 { return { a106: k, b106: k + 2, s106: "f" }; }
function copy106(from: R106, k: number): R106 { return { ...from, b106: k }; }
function fill106(k: number): R106 { const made = {} as R106; made.a106 = k; made.b106 = 1; made.s106 = "l"; return made; }
function rest106({ extra106, ...rest }: R106 & { extra106: number }): R106 { return rest; }
function choose106(k: number): R106 { let made: R106; switch (k & 3) { case 0: made = new Empty106A(); break; case 1: made = new Empty106B(); break; case 2: made = new Empty106C(); break; default: made = new Empty106A(); break; } made.a106 = k; made.b106 = 2; made.s106 = "w"; return made; }
function list106(k: number): number[] { return [k, k + 2, 5]; }
function hold106(k: number): { kept106: R106; rest106: number } { return { kept106: { a106: k, b106: 8, s106: "held" }, rest106: k }; }
const held106 = seen(hold106(7));
function alone106(k: number): number[] { return ((nums106.slice()) as number[]); }
function through106(k: number): number[] { return alone106(k + 1); }
function c106(k: number): unknown { return { top106: { inner106: ((nums106.slice()) as number[]), z106: k }, w106: k + 1 }; }
type R107 = { a107: number; b107: number; s107: string };
const src107: R107 = seen({ a107: 1, b107: 2.5, s107: "src" }), other107: R107 = seen({ a107: 3, b107: 4, s107: "other" }), wide107 = seen({ extra107: 9, a107: 5, b107: 6, s107: "wide" }), nums107: number[] = seen([1, 2, 3]);
const text107: string = seen(JSON.stringify(src107));
class Made107 { a107: number; b107: number; s107: string; constructor(a: number, b: number, s: string) { this.a107 = a; this.b107 = b; this.s107 = s; } }
class Initialized107 { a107 = 1; b107 = 2.5; s107 = "i"; }
class Empty107A { a107!: number; b107!: number; s107!: string; } class Empty107B { b107!: number; a107!: number; s107!: string; } class Empty107C { s107!: string; a107!: number; b107!: number; }
class Holder107 { inner107: number[]; z107: number; constructor(inner: number[], z: number) { this.inner107 = inner; this.z107 = z; } }
function make107(k: number): R107 { return { a107: k, b107: k + 2, s107: "f" }; }
function copy107(from: R107, k: number): R107 { return { ...from, b107: k }; }
function fill107(k: number): R107 { const made = {} as R107; made.a107 = k; made.b107 = 1; made.s107 = "l"; return made; }
function rest107({ extra107, ...rest }: R107 & { extra107: number }): R107 { return rest; }
function choose107(k: number): R107 { let made: R107; switch (k & 3) { case 0: made = new Empty107A(); break; case 1: made = new Empty107B(); break; case 2: made = new Empty107C(); break; default: made = new Empty107A(); break; } made.a107 = k; made.b107 = 2; made.s107 = "w"; return made; }
function list107(k: number): number[] { return [k, k + 2, 5]; }
function hold107(k: number): { kept107: R107; rest107: number } { return { kept107: { a107: k, b107: 8, s107: "held" }, rest107: k }; }
const held107 = seen(hold107(7));
function alone107(k: number): number[] { return ((nums107.slice()) as number[]); }
function through107(k: number): number[] { return alone107(k + 1); }
function c107(k: number): unknown { return { inner107: alone107(k), z107: k }; }
type R108 = { a108: number; b108: number; s108: string };
const src108: R108 = seen({ a108: 1, b108: 2.5, s108: "src" }), other108: R108 = seen({ a108: 3, b108: 4, s108: "other" }), wide108 = seen({ extra108: 9, a108: 5, b108: 6, s108: "wide" }), nums108: number[] = seen([1, 2, 3]);
const text108: string = seen(JSON.stringify(src108));
class Made108 { a108: number; b108: number; s108: string; constructor(a: number, b: number, s: string) { this.a108 = a; this.b108 = b; this.s108 = s; } }
class Initialized108 { a108 = 1; b108 = 2.5; s108 = "i"; }
class Empty108A { a108!: number; b108!: number; s108!: string; } class Empty108B { b108!: number; a108!: number; s108!: string; } class Empty108C { s108!: string; a108!: number; b108!: number; }
class Holder108 { inner108: number[]; z108: number; constructor(inner: number[], z: number) { this.inner108 = inner; this.z108 = z; } }
function make108(k: number): R108 { return { a108: k, b108: k + 2, s108: "f" }; }
function copy108(from: R108, k: number): R108 { return { ...from, b108: k }; }
function fill108(k: number): R108 { const made = {} as R108; made.a108 = k; made.b108 = 1; made.s108 = "l"; return made; }
function rest108({ extra108, ...rest }: R108 & { extra108: number }): R108 { return rest; }
function choose108(k: number): R108 { let made: R108; switch (k & 3) { case 0: made = new Empty108A(); break; case 1: made = new Empty108B(); break; case 2: made = new Empty108C(); break; default: made = new Empty108A(); break; } made.a108 = k; made.b108 = 2; made.s108 = "w"; return made; }
function list108(k: number): number[] { return [k, k + 2, 5]; }
function hold108(k: number): { kept108: R108; rest108: number } { return { kept108: { a108: k, b108: 8, s108: "held" }, rest108: k }; }
const held108 = seen(hold108(7));
function alone108(k: number): number[] { return ((nums108.map(v => v + k)) as number[]); }
function through108(k: number): number[] { return alone108(k + 1); }
function c108(k: number): unknown { return { inner108: ((nums108.map(v => v + k)) as number[]), z108: k }; }
type R109 = { a109: number; b109: number; s109: string };
const src109: R109 = seen({ a109: 1, b109: 2.5, s109: "src" }), other109: R109 = seen({ a109: 3, b109: 4, s109: "other" }), wide109 = seen({ extra109: 9, a109: 5, b109: 6, s109: "wide" }), nums109: number[] = seen([1, 2, 3]);
const text109: string = seen(JSON.stringify(src109));
class Made109 { a109: number; b109: number; s109: string; constructor(a: number, b: number, s: string) { this.a109 = a; this.b109 = b; this.s109 = s; } }
class Initialized109 { a109 = 1; b109 = 2.5; s109 = "i"; }
class Empty109A { a109!: number; b109!: number; s109!: string; } class Empty109B { b109!: number; a109!: number; s109!: string; } class Empty109C { s109!: string; a109!: number; b109!: number; }
class Holder109 { inner109: number[]; z109: number; constructor(inner: number[], z: number) { this.inner109 = inner; this.z109 = z; } }
function make109(k: number): R109 { return { a109: k, b109: k + 2, s109: "f" }; }
function copy109(from: R109, k: number): R109 { return { ...from, b109: k }; }
function fill109(k: number): R109 { const made = {} as R109; made.a109 = k; made.b109 = 1; made.s109 = "l"; return made; }
function rest109({ extra109, ...rest }: R109 & { extra109: number }): R109 { return rest; }
function choose109(k: number): R109 { let made: R109; switch (k & 3) { case 0: made = new Empty109A(); break; case 1: made = new Empty109B(); break; case 2: made = new Empty109C(); break; default: made = new Empty109A(); break; } made.a109 = k; made.b109 = 2; made.s109 = "w"; return made; }
function list109(k: number): number[] { return [k, k + 2, 5]; }
function hold109(k: number): { kept109: R109; rest109: number } { return { kept109: { a109: k, b109: 8, s109: "held" }, rest109: k }; }
const held109 = seen(hold109(7));
function alone109(k: number): number[] { return ((nums109.map(v => v + k)) as number[]); }
function through109(k: number): number[] { return alone109(k + 1); }
function c109(k: number): unknown { return { top109: { inner109: ((nums109.map(v => v + k)) as number[]), z109: k }, w109: k + 1 }; }
type R110 = { a110: number; b110: number; s110: string };
const src110: R110 = seen({ a110: 1, b110: 2.5, s110: "src" }), other110: R110 = seen({ a110: 3, b110: 4, s110: "other" }), wide110 = seen({ extra110: 9, a110: 5, b110: 6, s110: "wide" }), nums110: number[] = seen([1, 2, 3]);
const text110: string = seen(JSON.stringify(src110));
class Made110 { a110: number; b110: number; s110: string; constructor(a: number, b: number, s: string) { this.a110 = a; this.b110 = b; this.s110 = s; } }
class Initialized110 { a110 = 1; b110 = 2.5; s110 = "i"; }
class Empty110A { a110!: number; b110!: number; s110!: string; } class Empty110B { b110!: number; a110!: number; s110!: string; } class Empty110C { s110!: string; a110!: number; b110!: number; }
class Holder110 { inner110: number[]; z110: number; constructor(inner: number[], z: number) { this.inner110 = inner; this.z110 = z; } }
function make110(k: number): R110 { return { a110: k, b110: k + 2, s110: "f" }; }
function copy110(from: R110, k: number): R110 { return { ...from, b110: k }; }
function fill110(k: number): R110 { const made = {} as R110; made.a110 = k; made.b110 = 1; made.s110 = "l"; return made; }
function rest110({ extra110, ...rest }: R110 & { extra110: number }): R110 { return rest; }
function choose110(k: number): R110 { let made: R110; switch (k & 3) { case 0: made = new Empty110A(); break; case 1: made = new Empty110B(); break; case 2: made = new Empty110C(); break; default: made = new Empty110A(); break; } made.a110 = k; made.b110 = 2; made.s110 = "w"; return made; }
function list110(k: number): number[] { return [k, k + 2, 5]; }
function hold110(k: number): { kept110: R110; rest110: number } { return { kept110: { a110: k, b110: 8, s110: "held" }, rest110: k }; }
const held110 = seen(hold110(7));
function alone110(k: number): number[] { return ((nums110.map(v => v + k)) as number[]); }
function through110(k: number): number[] { return alone110(k + 1); }
function c110(k: number): unknown { return { inner110: alone110(k), z110: k }; }
type R111 = { a111: number; b111: number; s111: string };
const src111: R111 = seen({ a111: 1, b111: 2.5, s111: "src" }), other111: R111 = seen({ a111: 3, b111: 4, s111: "other" }), wide111 = seen({ extra111: 9, a111: 5, b111: 6, s111: "wide" }), nums111: number[] = seen([1, 2, 3]);
const text111: string = seen(JSON.stringify(src111));
class Made111 { a111: number; b111: number; s111: string; constructor(a: number, b: number, s: string) { this.a111 = a; this.b111 = b; this.s111 = s; } }
class Initialized111 { a111 = 1; b111 = 2.5; s111 = "i"; }
class Empty111A { a111!: number; b111!: number; s111!: string; } class Empty111B { b111!: number; a111!: number; s111!: string; } class Empty111C { s111!: string; a111!: number; b111!: number; }
class Holder111 { inner111: number[]; z111: number; constructor(inner: number[], z: number) { this.inner111 = inner; this.z111 = z; } }
function make111(k: number): R111 { return { a111: k, b111: k + 2, s111: "f" }; }
function copy111(from: R111, k: number): R111 { return { ...from, b111: k }; }
function fill111(k: number): R111 { const made = {} as R111; made.a111 = k; made.b111 = 1; made.s111 = "l"; return made; }
function rest111({ extra111, ...rest }: R111 & { extra111: number }): R111 { return rest; }
function choose111(k: number): R111 { let made: R111; switch (k & 3) { case 0: made = new Empty111A(); break; case 1: made = new Empty111B(); break; case 2: made = new Empty111C(); break; default: made = new Empty111A(); break; } made.a111 = k; made.b111 = 2; made.s111 = "w"; return made; }
function list111(k: number): number[] { return [k, k + 2, 5]; }
function hold111(k: number): { kept111: R111; rest111: number } { return { kept111: { a111: k, b111: 8, s111: "held" }, rest111: k }; }
const held111 = seen(hold111(7));
function alone111(k: number): number[] { return ((Array.from(nums111)) as number[]); }
function through111(k: number): number[] { return alone111(k + 1); }
function c111(k: number): unknown { return { inner111: ((Array.from(nums111)) as number[]), z111: k }; }
type R112 = { a112: number; b112: number; s112: string };
const src112: R112 = seen({ a112: 1, b112: 2.5, s112: "src" }), other112: R112 = seen({ a112: 3, b112: 4, s112: "other" }), wide112 = seen({ extra112: 9, a112: 5, b112: 6, s112: "wide" }), nums112: number[] = seen([1, 2, 3]);
const text112: string = seen(JSON.stringify(src112));
class Made112 { a112: number; b112: number; s112: string; constructor(a: number, b: number, s: string) { this.a112 = a; this.b112 = b; this.s112 = s; } }
class Initialized112 { a112 = 1; b112 = 2.5; s112 = "i"; }
class Empty112A { a112!: number; b112!: number; s112!: string; } class Empty112B { b112!: number; a112!: number; s112!: string; } class Empty112C { s112!: string; a112!: number; b112!: number; }
class Holder112 { inner112: number[]; z112: number; constructor(inner: number[], z: number) { this.inner112 = inner; this.z112 = z; } }
function make112(k: number): R112 { return { a112: k, b112: k + 2, s112: "f" }; }
function copy112(from: R112, k: number): R112 { return { ...from, b112: k }; }
function fill112(k: number): R112 { const made = {} as R112; made.a112 = k; made.b112 = 1; made.s112 = "l"; return made; }
function rest112({ extra112, ...rest }: R112 & { extra112: number }): R112 { return rest; }
function choose112(k: number): R112 { let made: R112; switch (k & 3) { case 0: made = new Empty112A(); break; case 1: made = new Empty112B(); break; case 2: made = new Empty112C(); break; default: made = new Empty112A(); break; } made.a112 = k; made.b112 = 2; made.s112 = "w"; return made; }
function list112(k: number): number[] { return [k, k + 2, 5]; }
function hold112(k: number): { kept112: R112; rest112: number } { return { kept112: { a112: k, b112: 8, s112: "held" }, rest112: k }; }
const held112 = seen(hold112(7));
function alone112(k: number): number[] { return ((Array.from(nums112)) as number[]); }
function through112(k: number): number[] { return alone112(k + 1); }
function c112(k: number): unknown { return { top112: { inner112: ((Array.from(nums112)) as number[]), z112: k }, w112: k + 1 }; }
type R113 = { a113: number; b113: number; s113: string };
const src113: R113 = seen({ a113: 1, b113: 2.5, s113: "src" }), other113: R113 = seen({ a113: 3, b113: 4, s113: "other" }), wide113 = seen({ extra113: 9, a113: 5, b113: 6, s113: "wide" }), nums113: number[] = seen([1, 2, 3]);
const text113: string = seen(JSON.stringify(src113));
class Made113 { a113: number; b113: number; s113: string; constructor(a: number, b: number, s: string) { this.a113 = a; this.b113 = b; this.s113 = s; } }
class Initialized113 { a113 = 1; b113 = 2.5; s113 = "i"; }
class Empty113A { a113!: number; b113!: number; s113!: string; } class Empty113B { b113!: number; a113!: number; s113!: string; } class Empty113C { s113!: string; a113!: number; b113!: number; }
class Holder113 { inner113: number[]; z113: number; constructor(inner: number[], z: number) { this.inner113 = inner; this.z113 = z; } }
function make113(k: number): R113 { return { a113: k, b113: k + 2, s113: "f" }; }
function copy113(from: R113, k: number): R113 { return { ...from, b113: k }; }
function fill113(k: number): R113 { const made = {} as R113; made.a113 = k; made.b113 = 1; made.s113 = "l"; return made; }
function rest113({ extra113, ...rest }: R113 & { extra113: number }): R113 { return rest; }
function choose113(k: number): R113 { let made: R113; switch (k & 3) { case 0: made = new Empty113A(); break; case 1: made = new Empty113B(); break; case 2: made = new Empty113C(); break; default: made = new Empty113A(); break; } made.a113 = k; made.b113 = 2; made.s113 = "w"; return made; }
function list113(k: number): number[] { return [k, k + 2, 5]; }
function hold113(k: number): { kept113: R113; rest113: number } { return { kept113: { a113: k, b113: 8, s113: "held" }, rest113: k }; }
const held113 = seen(hold113(7));
function alone113(k: number): number[] { return ((Array.from(nums113)) as number[]); }
function through113(k: number): number[] { return alone113(k + 1); }
function c113(k: number): unknown { return { inner113: alone113(k), z113: k }; }
type R114 = { a114: number; b114: number; s114: string };
const src114: R114 = seen({ a114: 1, b114: 2.5, s114: "src" }), other114: R114 = seen({ a114: 3, b114: 4, s114: "other" }), wide114 = seen({ extra114: 9, a114: 5, b114: 6, s114: "wide" }), nums114: number[] = seen([1, 2, 3]);
const text114: string = seen(JSON.stringify(src114));
class Made114 { a114: number; b114: number; s114: string; constructor(a: number, b: number, s: string) { this.a114 = a; this.b114 = b; this.s114 = s; } }
class Initialized114 { a114 = 1; b114 = 2.5; s114 = "i"; }
class Empty114A { a114!: number; b114!: number; s114!: string; } class Empty114B { b114!: number; a114!: number; s114!: string; } class Empty114C { s114!: string; a114!: number; b114!: number; }
class Holder114 { inner114: number[]; z114: number; constructor(inner: number[], z: number) { this.inner114 = inner; this.z114 = z; } }
function make114(k: number): R114 { return { a114: k, b114: k + 2, s114: "f" }; }
function copy114(from: R114, k: number): R114 { return { ...from, b114: k }; }
function fill114(k: number): R114 { const made = {} as R114; made.a114 = k; made.b114 = 1; made.s114 = "l"; return made; }
function rest114({ extra114, ...rest }: R114 & { extra114: number }): R114 { return rest; }
function choose114(k: number): R114 { let made: R114; switch (k & 3) { case 0: made = new Empty114A(); break; case 1: made = new Empty114B(); break; case 2: made = new Empty114C(); break; default: made = new Empty114A(); break; } made.a114 = k; made.b114 = 2; made.s114 = "w"; return made; }
function list114(k: number): number[] { return [k, k + 2, 5]; }
function hold114(k: number): { kept114: R114; rest114: number } { return { kept114: { a114: k, b114: 8, s114: "held" }, rest114: k }; }
const held114 = seen(hold114(7));
function alone114(k: number): number[] { return ((Array.of(k, 1)) as number[]); }
function through114(k: number): number[] { return alone114(k + 1); }
function c114(k: number): unknown { return { inner114: ((Array.of(k, 1)) as number[]), z114: k }; }
type R115 = { a115: number; b115: number; s115: string };
const src115: R115 = seen({ a115: 1, b115: 2.5, s115: "src" }), other115: R115 = seen({ a115: 3, b115: 4, s115: "other" }), wide115 = seen({ extra115: 9, a115: 5, b115: 6, s115: "wide" }), nums115: number[] = seen([1, 2, 3]);
const text115: string = seen(JSON.stringify(src115));
class Made115 { a115: number; b115: number; s115: string; constructor(a: number, b: number, s: string) { this.a115 = a; this.b115 = b; this.s115 = s; } }
class Initialized115 { a115 = 1; b115 = 2.5; s115 = "i"; }
class Empty115A { a115!: number; b115!: number; s115!: string; } class Empty115B { b115!: number; a115!: number; s115!: string; } class Empty115C { s115!: string; a115!: number; b115!: number; }
class Holder115 { inner115: number[]; z115: number; constructor(inner: number[], z: number) { this.inner115 = inner; this.z115 = z; } }
function make115(k: number): R115 { return { a115: k, b115: k + 2, s115: "f" }; }
function copy115(from: R115, k: number): R115 { return { ...from, b115: k }; }
function fill115(k: number): R115 { const made = {} as R115; made.a115 = k; made.b115 = 1; made.s115 = "l"; return made; }
function rest115({ extra115, ...rest }: R115 & { extra115: number }): R115 { return rest; }
function choose115(k: number): R115 { let made: R115; switch (k & 3) { case 0: made = new Empty115A(); break; case 1: made = new Empty115B(); break; case 2: made = new Empty115C(); break; default: made = new Empty115A(); break; } made.a115 = k; made.b115 = 2; made.s115 = "w"; return made; }
function list115(k: number): number[] { return [k, k + 2, 5]; }
function hold115(k: number): { kept115: R115; rest115: number } { return { kept115: { a115: k, b115: 8, s115: "held" }, rest115: k }; }
const held115 = seen(hold115(7));
function alone115(k: number): number[] { return ((Array.of(k, 1)) as number[]); }
function through115(k: number): number[] { return alone115(k + 1); }
function c115(k: number): unknown { return { top115: { inner115: ((Array.of(k, 1)) as number[]), z115: k }, w115: k + 1 }; }
type R116 = { a116: number; b116: number; s116: string };
const src116: R116 = seen({ a116: 1, b116: 2.5, s116: "src" }), other116: R116 = seen({ a116: 3, b116: 4, s116: "other" }), wide116 = seen({ extra116: 9, a116: 5, b116: 6, s116: "wide" }), nums116: number[] = seen([1, 2, 3]);
const text116: string = seen(JSON.stringify(src116));
class Made116 { a116: number; b116: number; s116: string; constructor(a: number, b: number, s: string) { this.a116 = a; this.b116 = b; this.s116 = s; } }
class Initialized116 { a116 = 1; b116 = 2.5; s116 = "i"; }
class Empty116A { a116!: number; b116!: number; s116!: string; } class Empty116B { b116!: number; a116!: number; s116!: string; } class Empty116C { s116!: string; a116!: number; b116!: number; }
class Holder116 { inner116: number[]; z116: number; constructor(inner: number[], z: number) { this.inner116 = inner; this.z116 = z; } }
function make116(k: number): R116 { return { a116: k, b116: k + 2, s116: "f" }; }
function copy116(from: R116, k: number): R116 { return { ...from, b116: k }; }
function fill116(k: number): R116 { const made = {} as R116; made.a116 = k; made.b116 = 1; made.s116 = "l"; return made; }
function rest116({ extra116, ...rest }: R116 & { extra116: number }): R116 { return rest; }
function choose116(k: number): R116 { let made: R116; switch (k & 3) { case 0: made = new Empty116A(); break; case 1: made = new Empty116B(); break; case 2: made = new Empty116C(); break; default: made = new Empty116A(); break; } made.a116 = k; made.b116 = 2; made.s116 = "w"; return made; }
function list116(k: number): number[] { return [k, k + 2, 5]; }
function hold116(k: number): { kept116: R116; rest116: number } { return { kept116: { a116: k, b116: 8, s116: "held" }, rest116: k }; }
const held116 = seen(hold116(7));
function alone116(k: number): number[] { return ((Array.of(k, 1)) as number[]); }
function through116(k: number): number[] { return alone116(k + 1); }
function c116(k: number): unknown { return { inner116: alone116(k), z116: k }; }
type R117 = { a117: number; b117: number; s117: string };
const src117: R117 = seen({ a117: 1, b117: 2.5, s117: "src" }), other117: R117 = seen({ a117: 3, b117: 4, s117: "other" }), wide117 = seen({ extra117: 9, a117: 5, b117: 6, s117: "wide" }), nums117: number[] = seen([1, 2, 3]);
const text117: string = seen(JSON.stringify(src117));
class Made117 { a117: number; b117: number; s117: string; constructor(a: number, b: number, s: string) { this.a117 = a; this.b117 = b; this.s117 = s; } }
class Initialized117 { a117 = 1; b117 = 2.5; s117 = "i"; }
class Empty117A { a117!: number; b117!: number; s117!: string; } class Empty117B { b117!: number; a117!: number; s117!: string; } class Empty117C { s117!: string; a117!: number; b117!: number; }
class Holder117 { inner117: number[]; z117: number; constructor(inner: number[], z: number) { this.inner117 = inner; this.z117 = z; } }
function make117(k: number): R117 { return { a117: k, b117: k + 2, s117: "f" }; }
function copy117(from: R117, k: number): R117 { return { ...from, b117: k }; }
function fill117(k: number): R117 { const made = {} as R117; made.a117 = k; made.b117 = 1; made.s117 = "l"; return made; }
function rest117({ extra117, ...rest }: R117 & { extra117: number }): R117 { return rest; }
function choose117(k: number): R117 { let made: R117; switch (k & 3) { case 0: made = new Empty117A(); break; case 1: made = new Empty117B(); break; case 2: made = new Empty117C(); break; default: made = new Empty117A(); break; } made.a117 = k; made.b117 = 2; made.s117 = "w"; return made; }
function list117(k: number): number[] { return [k, k + 2, 5]; }
function hold117(k: number): { kept117: R117; rest117: number } { return { kept117: { a117: k, b117: 8, s117: "held" }, rest117: k }; }
const held117 = seen(hold117(7));
function alone117(k: number): number[] { return ((new Array<number>(2).fill(k)) as number[]); }
function through117(k: number): number[] { return alone117(k + 1); }
function c117(k: number): unknown { return { inner117: ((new Array<number>(2).fill(k)) as number[]), z117: k }; }
type R118 = { a118: number; b118: number; s118: string };
const src118: R118 = seen({ a118: 1, b118: 2.5, s118: "src" }), other118: R118 = seen({ a118: 3, b118: 4, s118: "other" }), wide118 = seen({ extra118: 9, a118: 5, b118: 6, s118: "wide" }), nums118: number[] = seen([1, 2, 3]);
const text118: string = seen(JSON.stringify(src118));
class Made118 { a118: number; b118: number; s118: string; constructor(a: number, b: number, s: string) { this.a118 = a; this.b118 = b; this.s118 = s; } }
class Initialized118 { a118 = 1; b118 = 2.5; s118 = "i"; }
class Empty118A { a118!: number; b118!: number; s118!: string; } class Empty118B { b118!: number; a118!: number; s118!: string; } class Empty118C { s118!: string; a118!: number; b118!: number; }
class Holder118 { inner118: number[]; z118: number; constructor(inner: number[], z: number) { this.inner118 = inner; this.z118 = z; } }
function make118(k: number): R118 { return { a118: k, b118: k + 2, s118: "f" }; }
function copy118(from: R118, k: number): R118 { return { ...from, b118: k }; }
function fill118(k: number): R118 { const made = {} as R118; made.a118 = k; made.b118 = 1; made.s118 = "l"; return made; }
function rest118({ extra118, ...rest }: R118 & { extra118: number }): R118 { return rest; }
function choose118(k: number): R118 { let made: R118; switch (k & 3) { case 0: made = new Empty118A(); break; case 1: made = new Empty118B(); break; case 2: made = new Empty118C(); break; default: made = new Empty118A(); break; } made.a118 = k; made.b118 = 2; made.s118 = "w"; return made; }
function list118(k: number): number[] { return [k, k + 2, 5]; }
function hold118(k: number): { kept118: R118; rest118: number } { return { kept118: { a118: k, b118: 8, s118: "held" }, rest118: k }; }
const held118 = seen(hold118(7));
function alone118(k: number): number[] { return ((new Array<number>(2).fill(k)) as number[]); }
function through118(k: number): number[] { return alone118(k + 1); }
function c118(k: number): unknown { return { top118: { inner118: ((new Array<number>(2).fill(k)) as number[]), z118: k }, w118: k + 1 }; }
type R119 = { a119: number; b119: number; s119: string };
const src119: R119 = seen({ a119: 1, b119: 2.5, s119: "src" }), other119: R119 = seen({ a119: 3, b119: 4, s119: "other" }), wide119 = seen({ extra119: 9, a119: 5, b119: 6, s119: "wide" }), nums119: number[] = seen([1, 2, 3]);
const text119: string = seen(JSON.stringify(src119));
class Made119 { a119: number; b119: number; s119: string; constructor(a: number, b: number, s: string) { this.a119 = a; this.b119 = b; this.s119 = s; } }
class Initialized119 { a119 = 1; b119 = 2.5; s119 = "i"; }
class Empty119A { a119!: number; b119!: number; s119!: string; } class Empty119B { b119!: number; a119!: number; s119!: string; } class Empty119C { s119!: string; a119!: number; b119!: number; }
class Holder119 { inner119: number[]; z119: number; constructor(inner: number[], z: number) { this.inner119 = inner; this.z119 = z; } }
function make119(k: number): R119 { return { a119: k, b119: k + 2, s119: "f" }; }
function copy119(from: R119, k: number): R119 { return { ...from, b119: k }; }
function fill119(k: number): R119 { const made = {} as R119; made.a119 = k; made.b119 = 1; made.s119 = "l"; return made; }
function rest119({ extra119, ...rest }: R119 & { extra119: number }): R119 { return rest; }
function choose119(k: number): R119 { let made: R119; switch (k & 3) { case 0: made = new Empty119A(); break; case 1: made = new Empty119B(); break; case 2: made = new Empty119C(); break; default: made = new Empty119A(); break; } made.a119 = k; made.b119 = 2; made.s119 = "w"; return made; }
function list119(k: number): number[] { return [k, k + 2, 5]; }
function hold119(k: number): { kept119: R119; rest119: number } { return { kept119: { a119: k, b119: 8, s119: "held" }, rest119: k }; }
const held119 = seen(hold119(7));
function alone119(k: number): number[] { return ((new Array<number>(2).fill(k)) as number[]); }
function through119(k: number): number[] { return alone119(k + 1); }
function c119(k: number): unknown { return { inner119: alone119(k), z119: k }; }
type R120 = { a120: number; b120: number; s120: string };
const src120: R120 = seen({ a120: 1, b120: 2.5, s120: "src" }), other120: R120 = seen({ a120: 3, b120: 4, s120: "other" }), wide120 = seen({ extra120: 9, a120: 5, b120: 6, s120: "wide" }), nums120: number[] = seen([1, 2, 3]);
const text120: string = seen(JSON.stringify(src120));
class Made120 { a120: number; b120: number; s120: string; constructor(a: number, b: number, s: string) { this.a120 = a; this.b120 = b; this.s120 = s; } }
class Initialized120 { a120 = 1; b120 = 2.5; s120 = "i"; }
class Empty120A { a120!: number; b120!: number; s120!: string; } class Empty120B { b120!: number; a120!: number; s120!: string; } class Empty120C { s120!: string; a120!: number; b120!: number; }
class Holder120 { inner120: number[]; z120: number; constructor(inner: number[], z: number) { this.inner120 = inner; this.z120 = z; } }
function make120(k: number): R120 { return { a120: k, b120: k + 2, s120: "f" }; }
function copy120(from: R120, k: number): R120 { return { ...from, b120: k }; }
function fill120(k: number): R120 { const made = {} as R120; made.a120 = k; made.b120 = 1; made.s120 = "l"; return made; }
function rest120({ extra120, ...rest }: R120 & { extra120: number }): R120 { return rest; }
function choose120(k: number): R120 { let made: R120; switch (k & 3) { case 0: made = new Empty120A(); break; case 1: made = new Empty120B(); break; case 2: made = new Empty120C(); break; default: made = new Empty120A(); break; } made.a120 = k; made.b120 = 2; made.s120 = "w"; return made; }
function list120(k: number): number[] { return [k, k + 2, 5]; }
function hold120(k: number): { kept120: R120; rest120: number } { return { kept120: { a120: k, b120: 8, s120: "held" }, rest120: k }; }
const held120 = seen(hold120(7));
function alone120(k: number): number[] { return ((k & 1 ? [k] : [k, 1]) as number[]); }
function through120(k: number): number[] { return alone120(k + 1); }
function c120(k: number): unknown { return { inner120: ((k & 1 ? [k] : [k, 1]) as number[]), z120: k }; }
type R121 = { a121: number; b121: number; s121: string };
const src121: R121 = seen({ a121: 1, b121: 2.5, s121: "src" }), other121: R121 = seen({ a121: 3, b121: 4, s121: "other" }), wide121 = seen({ extra121: 9, a121: 5, b121: 6, s121: "wide" }), nums121: number[] = seen([1, 2, 3]);
const text121: string = seen(JSON.stringify(src121));
class Made121 { a121: number; b121: number; s121: string; constructor(a: number, b: number, s: string) { this.a121 = a; this.b121 = b; this.s121 = s; } }
class Initialized121 { a121 = 1; b121 = 2.5; s121 = "i"; }
class Empty121A { a121!: number; b121!: number; s121!: string; } class Empty121B { b121!: number; a121!: number; s121!: string; } class Empty121C { s121!: string; a121!: number; b121!: number; }
class Holder121 { inner121: number[]; z121: number; constructor(inner: number[], z: number) { this.inner121 = inner; this.z121 = z; } }
function make121(k: number): R121 { return { a121: k, b121: k + 2, s121: "f" }; }
function copy121(from: R121, k: number): R121 { return { ...from, b121: k }; }
function fill121(k: number): R121 { const made = {} as R121; made.a121 = k; made.b121 = 1; made.s121 = "l"; return made; }
function rest121({ extra121, ...rest }: R121 & { extra121: number }): R121 { return rest; }
function choose121(k: number): R121 { let made: R121; switch (k & 3) { case 0: made = new Empty121A(); break; case 1: made = new Empty121B(); break; case 2: made = new Empty121C(); break; default: made = new Empty121A(); break; } made.a121 = k; made.b121 = 2; made.s121 = "w"; return made; }
function list121(k: number): number[] { return [k, k + 2, 5]; }
function hold121(k: number): { kept121: R121; rest121: number } { return { kept121: { a121: k, b121: 8, s121: "held" }, rest121: k }; }
const held121 = seen(hold121(7));
function alone121(k: number): number[] { return ((k & 1 ? [k] : [k, 1]) as number[]); }
function through121(k: number): number[] { return alone121(k + 1); }
function c121(k: number): unknown { return { top121: { inner121: ((k & 1 ? [k] : [k, 1]) as number[]), z121: k }, w121: k + 1 }; }
type R122 = { a122: number; b122: number; s122: string };
const src122: R122 = seen({ a122: 1, b122: 2.5, s122: "src" }), other122: R122 = seen({ a122: 3, b122: 4, s122: "other" }), wide122 = seen({ extra122: 9, a122: 5, b122: 6, s122: "wide" }), nums122: number[] = seen([1, 2, 3]);
const text122: string = seen(JSON.stringify(src122));
class Made122 { a122: number; b122: number; s122: string; constructor(a: number, b: number, s: string) { this.a122 = a; this.b122 = b; this.s122 = s; } }
class Initialized122 { a122 = 1; b122 = 2.5; s122 = "i"; }
class Empty122A { a122!: number; b122!: number; s122!: string; } class Empty122B { b122!: number; a122!: number; s122!: string; } class Empty122C { s122!: string; a122!: number; b122!: number; }
class Holder122 { inner122: number[]; z122: number; constructor(inner: number[], z: number) { this.inner122 = inner; this.z122 = z; } }
function make122(k: number): R122 { return { a122: k, b122: k + 2, s122: "f" }; }
function copy122(from: R122, k: number): R122 { return { ...from, b122: k }; }
function fill122(k: number): R122 { const made = {} as R122; made.a122 = k; made.b122 = 1; made.s122 = "l"; return made; }
function rest122({ extra122, ...rest }: R122 & { extra122: number }): R122 { return rest; }
function choose122(k: number): R122 { let made: R122; switch (k & 3) { case 0: made = new Empty122A(); break; case 1: made = new Empty122B(); break; case 2: made = new Empty122C(); break; default: made = new Empty122A(); break; } made.a122 = k; made.b122 = 2; made.s122 = "w"; return made; }
function list122(k: number): number[] { return [k, k + 2, 5]; }
function hold122(k: number): { kept122: R122; rest122: number } { return { kept122: { a122: k, b122: 8, s122: "held" }, rest122: k }; }
const held122 = seen(hold122(7));
function alone122(k: number): number[] { return ((k & 1 ? [k] : [k, 1]) as number[]); }
function through122(k: number): number[] { return alone122(k + 1); }
function c122(k: number): unknown { return { inner122: alone122(k), z122: k }; }
type R123 = { a123: number; b123: number; s123: string };
const src123: R123 = seen({ a123: 1, b123: 2.5, s123: "src" }), other123: R123 = seen({ a123: 3, b123: 4, s123: "other" }), wide123 = seen({ extra123: 9, a123: 5, b123: 6, s123: "wide" }), nums123: number[] = seen([1, 2, 3]);
const text123: string = seen(JSON.stringify(src123));
class Made123 { a123: number; b123: number; s123: string; constructor(a: number, b: number, s: string) { this.a123 = a; this.b123 = b; this.s123 = s; } }
class Initialized123 { a123 = 1; b123 = 2.5; s123 = "i"; }
class Empty123A { a123!: number; b123!: number; s123!: string; } class Empty123B { b123!: number; a123!: number; s123!: string; } class Empty123C { s123!: string; a123!: number; b123!: number; }
class Holder123 { inner123: number[]; z123: number; constructor(inner: number[], z: number) { this.inner123 = inner; this.z123 = z; } }
function make123(k: number): R123 { return { a123: k, b123: k + 2, s123: "f" }; }
function copy123(from: R123, k: number): R123 { return { ...from, b123: k }; }
function fill123(k: number): R123 { const made = {} as R123; made.a123 = k; made.b123 = 1; made.s123 = "l"; return made; }
function rest123({ extra123, ...rest }: R123 & { extra123: number }): R123 { return rest; }
function choose123(k: number): R123 { let made: R123; switch (k & 3) { case 0: made = new Empty123A(); break; case 1: made = new Empty123B(); break; case 2: made = new Empty123C(); break; default: made = new Empty123A(); break; } made.a123 = k; made.b123 = 2; made.s123 = "w"; return made; }
function list123(k: number): number[] { return [k, k + 2, 5]; }
function hold123(k: number): { kept123: R123; rest123: number } { return { kept123: { a123: k, b123: 8, s123: "held" }, rest123: k }; }
const held123 = seen(hold123(7));
function alone123(k: number): number[] { return ((k & 1 ? [k, 2] : nums123) as number[]); }
function through123(k: number): number[] { return alone123(k + 1); }
function c123(k: number): unknown { return { inner123: ((k & 1 ? [k, 2] : nums123) as number[]), z123: k }; }
type R124 = { a124: number; b124: number; s124: string };
const src124: R124 = seen({ a124: 1, b124: 2.5, s124: "src" }), other124: R124 = seen({ a124: 3, b124: 4, s124: "other" }), wide124 = seen({ extra124: 9, a124: 5, b124: 6, s124: "wide" }), nums124: number[] = seen([1, 2, 3]);
const text124: string = seen(JSON.stringify(src124));
class Made124 { a124: number; b124: number; s124: string; constructor(a: number, b: number, s: string) { this.a124 = a; this.b124 = b; this.s124 = s; } }
class Initialized124 { a124 = 1; b124 = 2.5; s124 = "i"; }
class Empty124A { a124!: number; b124!: number; s124!: string; } class Empty124B { b124!: number; a124!: number; s124!: string; } class Empty124C { s124!: string; a124!: number; b124!: number; }
class Holder124 { inner124: number[]; z124: number; constructor(inner: number[], z: number) { this.inner124 = inner; this.z124 = z; } }
function make124(k: number): R124 { return { a124: k, b124: k + 2, s124: "f" }; }
function copy124(from: R124, k: number): R124 { return { ...from, b124: k }; }
function fill124(k: number): R124 { const made = {} as R124; made.a124 = k; made.b124 = 1; made.s124 = "l"; return made; }
function rest124({ extra124, ...rest }: R124 & { extra124: number }): R124 { return rest; }
function choose124(k: number): R124 { let made: R124; switch (k & 3) { case 0: made = new Empty124A(); break; case 1: made = new Empty124B(); break; case 2: made = new Empty124C(); break; default: made = new Empty124A(); break; } made.a124 = k; made.b124 = 2; made.s124 = "w"; return made; }
function list124(k: number): number[] { return [k, k + 2, 5]; }
function hold124(k: number): { kept124: R124; rest124: number } { return { kept124: { a124: k, b124: 8, s124: "held" }, rest124: k }; }
const held124 = seen(hold124(7));
function alone124(k: number): number[] { return ((k & 1 ? [k, 2] : nums124) as number[]); }
function through124(k: number): number[] { return alone124(k + 1); }
function c124(k: number): unknown { return { top124: { inner124: ((k & 1 ? [k, 2] : nums124) as number[]), z124: k }, w124: k + 1 }; }
type R125 = { a125: number; b125: number; s125: string };
const src125: R125 = seen({ a125: 1, b125: 2.5, s125: "src" }), other125: R125 = seen({ a125: 3, b125: 4, s125: "other" }), wide125 = seen({ extra125: 9, a125: 5, b125: 6, s125: "wide" }), nums125: number[] = seen([1, 2, 3]);
const text125: string = seen(JSON.stringify(src125));
class Made125 { a125: number; b125: number; s125: string; constructor(a: number, b: number, s: string) { this.a125 = a; this.b125 = b; this.s125 = s; } }
class Initialized125 { a125 = 1; b125 = 2.5; s125 = "i"; }
class Empty125A { a125!: number; b125!: number; s125!: string; } class Empty125B { b125!: number; a125!: number; s125!: string; } class Empty125C { s125!: string; a125!: number; b125!: number; }
class Holder125 { inner125: number[]; z125: number; constructor(inner: number[], z: number) { this.inner125 = inner; this.z125 = z; } }
function make125(k: number): R125 { return { a125: k, b125: k + 2, s125: "f" }; }
function copy125(from: R125, k: number): R125 { return { ...from, b125: k }; }
function fill125(k: number): R125 { const made = {} as R125; made.a125 = k; made.b125 = 1; made.s125 = "l"; return made; }
function rest125({ extra125, ...rest }: R125 & { extra125: number }): R125 { return rest; }
function choose125(k: number): R125 { let made: R125; switch (k & 3) { case 0: made = new Empty125A(); break; case 1: made = new Empty125B(); break; case 2: made = new Empty125C(); break; default: made = new Empty125A(); break; } made.a125 = k; made.b125 = 2; made.s125 = "w"; return made; }
function list125(k: number): number[] { return [k, k + 2, 5]; }
function hold125(k: number): { kept125: R125; rest125: number } { return { kept125: { a125: k, b125: 8, s125: "held" }, rest125: k }; }
const held125 = seen(hold125(7));
function alone125(k: number): number[] { return ((k & 1 ? [k, 2] : nums125) as number[]); }
function through125(k: number): number[] { return alone125(k + 1); }
function c125(k: number): unknown { return { inner125: alone125(k), z125: k }; }
type R126 = { a126: number; b126: number; s126: string };
const src126: R126 = seen({ a126: 1, b126: 2.5, s126: "src" }), other126: R126 = seen({ a126: 3, b126: 4, s126: "other" }), wide126 = seen({ extra126: 9, a126: 5, b126: 6, s126: "wide" }), nums126: number[] = seen([1, 2, 3]);
const text126: string = seen(JSON.stringify(src126));
class Made126 { a126: number; b126: number; s126: string; constructor(a: number, b: number, s: string) { this.a126 = a; this.b126 = b; this.s126 = s; } }
class Initialized126 { a126 = 1; b126 = 2.5; s126 = "i"; }
class Empty126A { a126!: number; b126!: number; s126!: string; } class Empty126B { b126!: number; a126!: number; s126!: string; } class Empty126C { s126!: string; a126!: number; b126!: number; }
class Holder126 { inner126: number[]; z126: number; constructor(inner: number[], z: number) { this.inner126 = inner; this.z126 = z; } }
function make126(k: number): R126 { return { a126: k, b126: k + 2, s126: "f" }; }
function copy126(from: R126, k: number): R126 { return { ...from, b126: k }; }
function fill126(k: number): R126 { const made = {} as R126; made.a126 = k; made.b126 = 1; made.s126 = "l"; return made; }
function rest126({ extra126, ...rest }: R126 & { extra126: number }): R126 { return rest; }
function choose126(k: number): R126 { let made: R126; switch (k & 3) { case 0: made = new Empty126A(); break; case 1: made = new Empty126B(); break; case 2: made = new Empty126C(); break; default: made = new Empty126A(); break; } made.a126 = k; made.b126 = 2; made.s126 = "w"; return made; }
function list126(k: number): number[] { return [k, k + 2, 5]; }
function hold126(k: number): { kept126: R126; rest126: number } { return { kept126: { a126: k, b126: 8, s126: "held" }, rest126: k }; }
const held126 = seen(hold126(7));
function alone126(k: number): number[] { return ((list126(k)) as number[]); }
function through126(k: number): number[] { return alone126(k + 1); }
function c126(k: number): unknown { return { inner126: ((list126(k)) as number[]), z126: k }; }
type R127 = { a127: number; b127: number; s127: string };
const src127: R127 = seen({ a127: 1, b127: 2.5, s127: "src" }), other127: R127 = seen({ a127: 3, b127: 4, s127: "other" }), wide127 = seen({ extra127: 9, a127: 5, b127: 6, s127: "wide" }), nums127: number[] = seen([1, 2, 3]);
const text127: string = seen(JSON.stringify(src127));
class Made127 { a127: number; b127: number; s127: string; constructor(a: number, b: number, s: string) { this.a127 = a; this.b127 = b; this.s127 = s; } }
class Initialized127 { a127 = 1; b127 = 2.5; s127 = "i"; }
class Empty127A { a127!: number; b127!: number; s127!: string; } class Empty127B { b127!: number; a127!: number; s127!: string; } class Empty127C { s127!: string; a127!: number; b127!: number; }
class Holder127 { inner127: number[]; z127: number; constructor(inner: number[], z: number) { this.inner127 = inner; this.z127 = z; } }
function make127(k: number): R127 { return { a127: k, b127: k + 2, s127: "f" }; }
function copy127(from: R127, k: number): R127 { return { ...from, b127: k }; }
function fill127(k: number): R127 { const made = {} as R127; made.a127 = k; made.b127 = 1; made.s127 = "l"; return made; }
function rest127({ extra127, ...rest }: R127 & { extra127: number }): R127 { return rest; }
function choose127(k: number): R127 { let made: R127; switch (k & 3) { case 0: made = new Empty127A(); break; case 1: made = new Empty127B(); break; case 2: made = new Empty127C(); break; default: made = new Empty127A(); break; } made.a127 = k; made.b127 = 2; made.s127 = "w"; return made; }
function list127(k: number): number[] { return [k, k + 2, 5]; }
function hold127(k: number): { kept127: R127; rest127: number } { return { kept127: { a127: k, b127: 8, s127: "held" }, rest127: k }; }
const held127 = seen(hold127(7));
function alone127(k: number): number[] { return ((list127(k)) as number[]); }
function through127(k: number): number[] { return alone127(k + 1); }
function c127(k: number): unknown { return { top127: { inner127: ((list127(k)) as number[]), z127: k }, w127: k + 1 }; }
type R128 = { a128: number; b128: number; s128: string };
const src128: R128 = seen({ a128: 1, b128: 2.5, s128: "src" }), other128: R128 = seen({ a128: 3, b128: 4, s128: "other" }), wide128 = seen({ extra128: 9, a128: 5, b128: 6, s128: "wide" }), nums128: number[] = seen([1, 2, 3]);
const text128: string = seen(JSON.stringify(src128));
class Made128 { a128: number; b128: number; s128: string; constructor(a: number, b: number, s: string) { this.a128 = a; this.b128 = b; this.s128 = s; } }
class Initialized128 { a128 = 1; b128 = 2.5; s128 = "i"; }
class Empty128A { a128!: number; b128!: number; s128!: string; } class Empty128B { b128!: number; a128!: number; s128!: string; } class Empty128C { s128!: string; a128!: number; b128!: number; }
class Holder128 { inner128: number[]; z128: number; constructor(inner: number[], z: number) { this.inner128 = inner; this.z128 = z; } }
function make128(k: number): R128 { return { a128: k, b128: k + 2, s128: "f" }; }
function copy128(from: R128, k: number): R128 { return { ...from, b128: k }; }
function fill128(k: number): R128 { const made = {} as R128; made.a128 = k; made.b128 = 1; made.s128 = "l"; return made; }
function rest128({ extra128, ...rest }: R128 & { extra128: number }): R128 { return rest; }
function choose128(k: number): R128 { let made: R128; switch (k & 3) { case 0: made = new Empty128A(); break; case 1: made = new Empty128B(); break; case 2: made = new Empty128C(); break; default: made = new Empty128A(); break; } made.a128 = k; made.b128 = 2; made.s128 = "w"; return made; }
function list128(k: number): number[] { return [k, k + 2, 5]; }
function hold128(k: number): { kept128: R128; rest128: number } { return { kept128: { a128: k, b128: 8, s128: "held" }, rest128: k }; }
const held128 = seen(hold128(7));
function alone128(k: number): number[] { return ((list128(k)) as number[]); }
function through128(k: number): number[] { return alone128(k + 1); }
function c128(k: number): unknown { return { inner128: alone128(k), z128: k }; }
type R129 = { a129: number; b129: number; s129: string };
const src129: R129 = seen({ a129: 1, b129: 2.5, s129: "src" }), other129: R129 = seen({ a129: 3, b129: 4, s129: "other" }), wide129 = seen({ extra129: 9, a129: 5, b129: 6, s129: "wide" }), nums129: number[] = seen([1, 2, 3]);
const text129: string = seen(JSON.stringify(src129));
class Made129 { a129: number; b129: number; s129: string; constructor(a: number, b: number, s: string) { this.a129 = a; this.b129 = b; this.s129 = s; } }
class Initialized129 { a129 = 1; b129 = 2.5; s129 = "i"; }
class Empty129A { a129!: number; b129!: number; s129!: string; } class Empty129B { b129!: number; a129!: number; s129!: string; } class Empty129C { s129!: string; a129!: number; b129!: number; }
class Holder129 { inner129: number[]; z129: number; constructor(inner: number[], z: number) { this.inner129 = inner; this.z129 = z; } }
function make129(k: number): R129 { return { a129: k, b129: k + 2, s129: "f" }; }
function copy129(from: R129, k: number): R129 { return { ...from, b129: k }; }
function fill129(k: number): R129 { const made = {} as R129; made.a129 = k; made.b129 = 1; made.s129 = "l"; return made; }
function rest129({ extra129, ...rest }: R129 & { extra129: number }): R129 { return rest; }
function choose129(k: number): R129 { let made: R129; switch (k & 3) { case 0: made = new Empty129A(); break; case 1: made = new Empty129B(); break; case 2: made = new Empty129C(); break; default: made = new Empty129A(); break; } made.a129 = k; made.b129 = 2; made.s129 = "w"; return made; }
function list129(k: number): number[] { return [k, k + 2, 5]; }
function hold129(k: number): { kept129: R129; rest129: number } { return { kept129: { a129: k, b129: 8, s129: "held" }, rest129: k }; }
const held129 = seen(hold129(7));
function alone129(k: number): number[] { return ((pushed(k)) as number[]); }
function through129(k: number): number[] { return alone129(k + 1); }
function c129(k: number): unknown { return { inner129: ((pushed(k)) as number[]), z129: k }; }
type R130 = { a130: number; b130: number; s130: string };
const src130: R130 = seen({ a130: 1, b130: 2.5, s130: "src" }), other130: R130 = seen({ a130: 3, b130: 4, s130: "other" }), wide130 = seen({ extra130: 9, a130: 5, b130: 6, s130: "wide" }), nums130: number[] = seen([1, 2, 3]);
const text130: string = seen(JSON.stringify(src130));
class Made130 { a130: number; b130: number; s130: string; constructor(a: number, b: number, s: string) { this.a130 = a; this.b130 = b; this.s130 = s; } }
class Initialized130 { a130 = 1; b130 = 2.5; s130 = "i"; }
class Empty130A { a130!: number; b130!: number; s130!: string; } class Empty130B { b130!: number; a130!: number; s130!: string; } class Empty130C { s130!: string; a130!: number; b130!: number; }
class Holder130 { inner130: number[]; z130: number; constructor(inner: number[], z: number) { this.inner130 = inner; this.z130 = z; } }
function make130(k: number): R130 { return { a130: k, b130: k + 2, s130: "f" }; }
function copy130(from: R130, k: number): R130 { return { ...from, b130: k }; }
function fill130(k: number): R130 { const made = {} as R130; made.a130 = k; made.b130 = 1; made.s130 = "l"; return made; }
function rest130({ extra130, ...rest }: R130 & { extra130: number }): R130 { return rest; }
function choose130(k: number): R130 { let made: R130; switch (k & 3) { case 0: made = new Empty130A(); break; case 1: made = new Empty130B(); break; case 2: made = new Empty130C(); break; default: made = new Empty130A(); break; } made.a130 = k; made.b130 = 2; made.s130 = "w"; return made; }
function list130(k: number): number[] { return [k, k + 2, 5]; }
function hold130(k: number): { kept130: R130; rest130: number } { return { kept130: { a130: k, b130: 8, s130: "held" }, rest130: k }; }
const held130 = seen(hold130(7));
function alone130(k: number): number[] { return ((pushed(k)) as number[]); }
function through130(k: number): number[] { return alone130(k + 1); }
function c130(k: number): unknown { return { top130: { inner130: ((pushed(k)) as number[]), z130: k }, w130: k + 1 }; }
type R131 = { a131: number; b131: number; s131: string };
const src131: R131 = seen({ a131: 1, b131: 2.5, s131: "src" }), other131: R131 = seen({ a131: 3, b131: 4, s131: "other" }), wide131 = seen({ extra131: 9, a131: 5, b131: 6, s131: "wide" }), nums131: number[] = seen([1, 2, 3]);
const text131: string = seen(JSON.stringify(src131));
class Made131 { a131: number; b131: number; s131: string; constructor(a: number, b: number, s: string) { this.a131 = a; this.b131 = b; this.s131 = s; } }
class Initialized131 { a131 = 1; b131 = 2.5; s131 = "i"; }
class Empty131A { a131!: number; b131!: number; s131!: string; } class Empty131B { b131!: number; a131!: number; s131!: string; } class Empty131C { s131!: string; a131!: number; b131!: number; }
class Holder131 { inner131: number[]; z131: number; constructor(inner: number[], z: number) { this.inner131 = inner; this.z131 = z; } }
function make131(k: number): R131 { return { a131: k, b131: k + 2, s131: "f" }; }
function copy131(from: R131, k: number): R131 { return { ...from, b131: k }; }
function fill131(k: number): R131 { const made = {} as R131; made.a131 = k; made.b131 = 1; made.s131 = "l"; return made; }
function rest131({ extra131, ...rest }: R131 & { extra131: number }): R131 { return rest; }
function choose131(k: number): R131 { let made: R131; switch (k & 3) { case 0: made = new Empty131A(); break; case 1: made = new Empty131B(); break; case 2: made = new Empty131C(); break; default: made = new Empty131A(); break; } made.a131 = k; made.b131 = 2; made.s131 = "w"; return made; }
function list131(k: number): number[] { return [k, k + 2, 5]; }
function hold131(k: number): { kept131: R131; rest131: number } { return { kept131: { a131: k, b131: 8, s131: "held" }, rest131: k }; }
const held131 = seen(hold131(7));
function alone131(k: number): number[] { return ((pushed(k)) as number[]); }
function through131(k: number): number[] { return alone131(k + 1); }
function c131(k: number): unknown { return { inner131: alone131(k), z131: k }; }
type R132 = { a132: number; b132: number; s132: string };
const src132: R132 = seen({ a132: 1, b132: 2.5, s132: "src" }), other132: R132 = seen({ a132: 3, b132: 4, s132: "other" }), wide132 = seen({ extra132: 9, a132: 5, b132: 6, s132: "wide" }), nums132: number[] = seen([1, 2, 3]);
const text132: string = seen(JSON.stringify(src132));
class Made132 { a132: number; b132: number; s132: string; constructor(a: number, b: number, s: string) { this.a132 = a; this.b132 = b; this.s132 = s; } }
class Initialized132 { a132 = 1; b132 = 2.5; s132 = "i"; }
class Empty132A { a132!: number; b132!: number; s132!: string; } class Empty132B { b132!: number; a132!: number; s132!: string; } class Empty132C { s132!: string; a132!: number; b132!: number; }
class Holder132 { inner132: number[]; z132: number; constructor(inner: number[], z: number) { this.inner132 = inner; this.z132 = z; } }
function make132(k: number): R132 { return { a132: k, b132: k + 2, s132: "f" }; }
function copy132(from: R132, k: number): R132 { return { ...from, b132: k }; }
function fill132(k: number): R132 { const made = {} as R132; made.a132 = k; made.b132 = 1; made.s132 = "l"; return made; }
function rest132({ extra132, ...rest }: R132 & { extra132: number }): R132 { return rest; }
function choose132(k: number): R132 { let made: R132; switch (k & 3) { case 0: made = new Empty132A(); break; case 1: made = new Empty132B(); break; case 2: made = new Empty132C(); break; default: made = new Empty132A(); break; } made.a132 = k; made.b132 = 2; made.s132 = "w"; return made; }
function list132(k: number): number[] { return [k, k + 2, 5]; }
function hold132(k: number): { kept132: R132; rest132: number } { return { kept132: { a132: k, b132: 8, s132: "held" }, rest132: k }; }
const held132 = seen(hold132(7));
function alone132(k: number): number[] { return ((nums132.concat(k)) as number[]); }
function through132(k: number): number[] { return alone132(k + 1); }
function c132(k: number): unknown { return { inner132: ((nums132.concat(k)) as number[]), z132: k }; }
type R133 = { a133: number; b133: number; s133: string };
const src133: R133 = seen({ a133: 1, b133: 2.5, s133: "src" }), other133: R133 = seen({ a133: 3, b133: 4, s133: "other" }), wide133 = seen({ extra133: 9, a133: 5, b133: 6, s133: "wide" }), nums133: number[] = seen([1, 2, 3]);
const text133: string = seen(JSON.stringify(src133));
class Made133 { a133: number; b133: number; s133: string; constructor(a: number, b: number, s: string) { this.a133 = a; this.b133 = b; this.s133 = s; } }
class Initialized133 { a133 = 1; b133 = 2.5; s133 = "i"; }
class Empty133A { a133!: number; b133!: number; s133!: string; } class Empty133B { b133!: number; a133!: number; s133!: string; } class Empty133C { s133!: string; a133!: number; b133!: number; }
class Holder133 { inner133: number[]; z133: number; constructor(inner: number[], z: number) { this.inner133 = inner; this.z133 = z; } }
function make133(k: number): R133 { return { a133: k, b133: k + 2, s133: "f" }; }
function copy133(from: R133, k: number): R133 { return { ...from, b133: k }; }
function fill133(k: number): R133 { const made = {} as R133; made.a133 = k; made.b133 = 1; made.s133 = "l"; return made; }
function rest133({ extra133, ...rest }: R133 & { extra133: number }): R133 { return rest; }
function choose133(k: number): R133 { let made: R133; switch (k & 3) { case 0: made = new Empty133A(); break; case 1: made = new Empty133B(); break; case 2: made = new Empty133C(); break; default: made = new Empty133A(); break; } made.a133 = k; made.b133 = 2; made.s133 = "w"; return made; }
function list133(k: number): number[] { return [k, k + 2, 5]; }
function hold133(k: number): { kept133: R133; rest133: number } { return { kept133: { a133: k, b133: 8, s133: "held" }, rest133: k }; }
const held133 = seen(hold133(7));
function alone133(k: number): number[] { return ((nums133.concat(k)) as number[]); }
function through133(k: number): number[] { return alone133(k + 1); }
function c133(k: number): unknown { return { top133: { inner133: ((nums133.concat(k)) as number[]), z133: k }, w133: k + 1 }; }
type R134 = { a134: number; b134: number; s134: string };
const src134: R134 = seen({ a134: 1, b134: 2.5, s134: "src" }), other134: R134 = seen({ a134: 3, b134: 4, s134: "other" }), wide134 = seen({ extra134: 9, a134: 5, b134: 6, s134: "wide" }), nums134: number[] = seen([1, 2, 3]);
const text134: string = seen(JSON.stringify(src134));
class Made134 { a134: number; b134: number; s134: string; constructor(a: number, b: number, s: string) { this.a134 = a; this.b134 = b; this.s134 = s; } }
class Initialized134 { a134 = 1; b134 = 2.5; s134 = "i"; }
class Empty134A { a134!: number; b134!: number; s134!: string; } class Empty134B { b134!: number; a134!: number; s134!: string; } class Empty134C { s134!: string; a134!: number; b134!: number; }
class Holder134 { inner134: number[]; z134: number; constructor(inner: number[], z: number) { this.inner134 = inner; this.z134 = z; } }
function make134(k: number): R134 { return { a134: k, b134: k + 2, s134: "f" }; }
function copy134(from: R134, k: number): R134 { return { ...from, b134: k }; }
function fill134(k: number): R134 { const made = {} as R134; made.a134 = k; made.b134 = 1; made.s134 = "l"; return made; }
function rest134({ extra134, ...rest }: R134 & { extra134: number }): R134 { return rest; }
function choose134(k: number): R134 { let made: R134; switch (k & 3) { case 0: made = new Empty134A(); break; case 1: made = new Empty134B(); break; case 2: made = new Empty134C(); break; default: made = new Empty134A(); break; } made.a134 = k; made.b134 = 2; made.s134 = "w"; return made; }
function list134(k: number): number[] { return [k, k + 2, 5]; }
function hold134(k: number): { kept134: R134; rest134: number } { return { kept134: { a134: k, b134: 8, s134: "held" }, rest134: k }; }
const held134 = seen(hold134(7));
function alone134(k: number): number[] { return ((nums134.concat(k)) as number[]); }
function through134(k: number): number[] { return alone134(k + 1); }
function c134(k: number): unknown { return { inner134: alone134(k), z134: k }; }
const CASES: [string, (k: number) => unknown][] = [["literal in-a-literal", c0], ["literal three-levels", c1], ["literal held-by-the-caller", c2], ["literal-of-doubles in-a-literal", c3], ["literal-of-doubles three-levels", c4], ["literal-of-doubles held-by-the-caller", c5], ["spread in-a-literal", c6], ["spread three-levels", c7], ["spread held-by-the-caller", c8], ["spread-then-field in-a-literal", c9], ["spread-then-field three-levels", c10], ["spread-then-field held-by-the-caller", c11], ["spread-then-two-fields in-a-literal", c12], ["spread-then-two-fields three-levels", c13], ["spread-then-two-fields held-by-the-caller", c14], ["field-then-spread in-a-literal", c15], ["field-then-spread three-levels", c16], ["field-then-spread held-by-the-caller", c17], ["two-spreads in-a-literal", c18], ["two-spreads three-levels", c19], ["two-spreads held-by-the-caller", c20], ["spread-of-either in-a-literal", c21], ["spread-of-either three-levels", c22], ["spread-of-either held-by-the-caller", c23], ["class in-a-literal", c24], ["class three-levels", c25], ["class held-by-the-caller", c26], ["class-with-initializers in-a-literal", c27], ["class-with-initializers three-levels", c28], ["class-with-initializers held-by-the-caller", c29], ["function in-a-literal", c30], ["function three-levels", c31], ["function held-by-the-caller", c32], ["function-that-copies in-a-literal", c33], ["function-that-copies three-levels", c34], ["function-that-copies held-by-the-caller", c35], ["filled-later in-a-literal", c36], ["filled-later three-levels", c37], ["filled-later held-by-the-caller", c38], ["assign in-a-literal", c39], ["assign three-levels", c40], ["assign held-by-the-caller", c41], ["assign-onto-literal in-a-literal", c42], ["assign-onto-literal three-levels", c43], ["assign-onto-literal held-by-the-caller", c44], ["clone in-a-literal", c45], ["clone three-levels", c46], ["clone held-by-the-caller", c47], ["parsed in-a-literal", c48], ["parsed three-levels", c49], ["parsed held-by-the-caller", c50], ["either-literal in-a-literal", c51], ["either-literal three-levels", c52], ["either-literal held-by-the-caller", c53], ["copy-or-literal in-a-literal", c54], ["copy-or-literal three-levels", c55], ["copy-or-literal held-by-the-caller", c56], ["copy-or-given in-a-literal", c57], ["copy-or-given three-levels", c58], ["copy-or-given held-by-the-caller", c59], ["rest in-a-literal", c60], ["rest three-levels", c61], ["rest held-by-the-caller", c62], ["by-switch in-a-literal", c63], ["by-switch three-levels", c64], ["by-switch held-by-the-caller", c65], ["frozen in-a-literal", c66], ["frozen three-levels", c67], ["frozen held-by-the-caller", c68], ["copy-of-copy in-a-literal", c69], ["copy-of-copy three-levels", c70], ["copy-of-copy held-by-the-caller", c71], ["copy-of-one-that-is-held in-a-literal", c72], ["copy-of-one-that-is-held three-levels", c73], ["copy-of-one-that-is-held held-by-the-caller", c74], ["copy-of-one-just-held in-a-literal", c75], ["copy-of-one-just-held three-levels", c76], ["copy-of-one-just-held held-by-the-caller", c77], ["one-that-is-held in-a-literal", c78], ["one-that-is-held three-levels", c79], ["one-that-is-held held-by-the-caller", c80], ["array in-a-literal", c81], ["array three-levels", c82], ["array held-by-the-caller", c83], ["array-of-doubles in-a-literal", c84], ["array-of-doubles three-levels", c85], ["array-of-doubles held-by-the-caller", c86], ["array-of-one in-a-literal", c87], ["array-of-one three-levels", c88], ["array-of-one held-by-the-caller", c89], ["empty-array in-a-literal", c90], ["empty-array three-levels", c91], ["empty-array held-by-the-caller", c92], ["array-of-seven in-a-literal", c93], ["array-of-seven three-levels", c94], ["array-of-seven held-by-the-caller", c95], ["array-of-eight in-a-literal", c96], ["array-of-eight three-levels", c97], ["array-of-eight held-by-the-caller", c98], ["array-spread in-a-literal", c99], ["array-spread three-levels", c100], ["array-spread held-by-the-caller", c101], ["array-spread-more in-a-literal", c102], ["array-spread-more three-levels", c103], ["array-spread-more held-by-the-caller", c104], ["array-slice in-a-literal", c105], ["array-slice three-levels", c106], ["array-slice held-by-the-caller", c107], ["array-map in-a-literal", c108], ["array-map three-levels", c109], ["array-map held-by-the-caller", c110], ["array-from in-a-literal", c111], ["array-from three-levels", c112], ["array-from held-by-the-caller", c113], ["array-of in-a-literal", c114], ["array-of three-levels", c115], ["array-of held-by-the-caller", c116], ["array-filled in-a-literal", c117], ["array-filled three-levels", c118], ["array-filled held-by-the-caller", c119], ["either-array in-a-literal", c120], ["either-array three-levels", c121], ["either-array held-by-the-caller", c122], ["array-or-given in-a-literal", c123], ["array-or-given three-levels", c124], ["array-or-given held-by-the-caller", c125], ["array-by-function in-a-literal", c126], ["array-by-function three-levels", c127], ["array-by-function held-by-the-caller", c128], ["array-pushed in-a-literal", c129], ["array-pushed three-levels", c130], ["array-pushed held-by-the-caller", c131], ["array-concat in-a-literal", c132], ["array-concat three-levels", c133], ["array-concat held-by-the-caller", c134]];
for (const [name, run] of CASES) {
  const ring: unknown[] = [], looks: string[] = [];
  let hash = 0, changed = 0, threw = 0;
  for (let k = 1; k <= 120; k++) {
    const before = { left: k, text: TEXTS[k & 3] };
    let result: unknown;
    try { result = await run(k); } catch (error) { result = "threw " + (error instanceof Error ? error.name : String(error)); threw++; }
    const after = [k, k + 0.5];
    const look = show([before, result, after]);
    hash = mix(hash, look);
    ring[k & 15] = [before, result, after];
    looks[k & 15] = look;
    if (k % 50 === 0) {
      if (k % 100 === 0) Bun.gc(true);
      for (let i = 0; i < ring.length; i++) if (ring[i] !== undefined && show(ring[i]) !== looks[i]) changed++;
    }
  }
  console.log(name, hash, changed, threw, looks[1]);
}
console.log(SEEN, show(STORED));
