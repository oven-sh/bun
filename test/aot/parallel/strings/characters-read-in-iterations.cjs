// Methods in iterations that read one character: positions and receivers of every kind.
"use strict";
const out = [];
let n = 0;
class Scanner {
  constructor(input) { this.input = input; this.pos = 0; }
  m0x0() { return this.input.charCodeAt(this.pos); }
  m0x4() { return this.input.charCodeAt(-1); }
  m0x8() { return this.input.charCodeAt("1"); }
  m0x12() { return this.input.charCodeAt(this.input.length); }
  m0x16() { return this.input.charCodeAt(Infinity); }
  m1x3() { return this.input.codePointAt(0); }
  m1x7() { return this.input.codePointAt(undefined); }
  m1x11() { return this.input.codePointAt(this.input.length - 1); }
  m1x15() { return this.input.codePointAt(this.pos++); }
  m1x19() { return this.input.codePointAt([2]); }
  m2x2() { return this.input.charAt(this.pos - 1); }
  m2x6() { return this.input.charAt(NaN); }
  m2x10() { return this.input.charAt(-0); }
  m2x14() { return this.input.charAt({ valueOf() { n++; return 1; } }); }
  m2x18() { return this.input.charAt(this.pos | 0); }
  m3x1() { return this.input.at(this.pos + 1); }
  m3x5() { return this.input.at(0.5); }
  m3x9() { return this.input.at(2 ** 31); }
  m3x13() { return this.input.at(null); }
  m3x17() { return this.input.at(this.pos / 2); }
  m4x0() { return (this.input.charCodeAt(this.pos) << 10) + this.input.charCodeAt(this.input.length) - 5; }
  m4x4() { return (this.input.charCodeAt(-1) << 10) + this.input.charCodeAt(Infinity) - 5; }
  m4x8() { return (this.input.charCodeAt("1") << 10) + this.input.charCodeAt(this.pos) - 5; }
  m4x12() { return (this.input.charCodeAt(this.input.length) << 10) + this.input.charCodeAt(-1) - 5; }
  m4x16() { return (this.input.charCodeAt(Infinity) << 10) + this.input.charCodeAt("1") - 5; }
  m5x3() { return this.input.charCodeAt(0) === 97 ? "a" : this.input.charCodeAt(this.pos | 0); }
  m5x7() { return this.input.charCodeAt(undefined) === 97 ? "a" : this.input.charCodeAt(this.pos - 1); }
  m5x11() { return this.input.charCodeAt(this.input.length - 1) === 97 ? "a" : this.input.charCodeAt(NaN); }
  m5x15() { return this.input.charCodeAt(this.pos++) === 97 ? "a" : this.input.charCodeAt(-0); }
  m5x19() { return this.input.charCodeAt([2]) === 97 ? "a" : this.input.charCodeAt({ valueOf() { n++; return 1; } }); }
  m6x2() { return this.input.charCodeAt(this.pos - 1) >= this.input.length; }
  m6x6() { return this.input.charCodeAt(NaN) >= this.input.length; }
  m6x10() { return this.input.charCodeAt(-0) >= this.input.length; }
  m6x14() { return this.input.charCodeAt({ valueOf() { n++; return 1; } }) >= this.input.length; }
  m6x18() { return this.input.charCodeAt(this.pos | 0) >= this.input.length; }
  m7x1() { return String.fromCharCode(this.input.charCodeAt(this.pos + 1)); }
  m7x5() { return String.fromCharCode(this.input.charCodeAt(0.5)); }
  m7x9() { return String.fromCharCode(this.input.charCodeAt(2 ** 31)); }
  m7x13() { return String.fromCharCode(this.input.charCodeAt(null)); }
  m7x17() { return String.fromCharCode(this.input.charCodeAt(this.pos / 2)); }
  m8x0() { return this.input.charCodeAt(); }
  m8x4() { return this.input.charCodeAt(); }
  m8x8() { return this.input.charCodeAt(); }
  m8x12() { return this.input.charCodeAt(); }
  m8x16() { return this.input.charCodeAt(); }
  m9x3() { return this.input.charCodeAt(0, -0); }
  m9x7() { return this.input.charCodeAt(undefined, { valueOf() { n++; return 1; } }); }
  m9x11() { return this.input.charCodeAt(this.input.length - 1, this.pos | 0); }
  m9x15() { return this.input.charCodeAt(this.pos++, this.pos - 1); }
  m9x19() { return this.input.charCodeAt([2], NaN); }
  m10x2() { return this.input?.charCodeAt?.(this.pos - 1); }
  m10x6() { return this.input?.charCodeAt?.(NaN); }
  m10x10() { return this.input?.charCodeAt?.(-0); }
  m10x14() { return this.input?.charCodeAt?.({ valueOf() { n++; return 1; } }); }
  m10x18() { return this.input?.charCodeAt?.(this.pos | 0); }
  m11x1() { return this.input.length + this.input.charCodeAt(this.pos + 1); }
  m11x5() { return this.input.length + this.input.charCodeAt(0.5); }
  m11x9() { return this.input.length + this.input.charCodeAt(2 ** 31); }
  m11x13() { return this.input.length + this.input.charCodeAt(null); }
  m11x17() { return this.input.length + this.input.charCodeAt(this.pos / 2); }
  m12x0() { return this.input.charCodeAt(this.pos) + this.input.charCodeAt(this.pos); }
  m12x4() { return this.input.charCodeAt(-1) + this.input.charCodeAt(-1); }
  m12x8() { return this.input.charCodeAt("1") + this.input.charCodeAt("1"); }
  m12x12() { return this.input.charCodeAt(this.input.length) + this.input.charCodeAt(this.input.length); }
  m12x16() { return this.input.charCodeAt(Infinity) + this.input.charCodeAt(Infinity); }
  m13x3() { return this.input[0]; }
  m13x7() { return this.input[undefined]; }
  m13x11() { return this.input[this.input.length - 1]; }
  m13x15() { return this.input[this.pos++]; }
  m13x19() { return this.input[[2]]; }
  scan(k) {
    let s = "";
    for (let i = 0; i < k; i++) {
      this.pos = i;
      try { s += String(this.m0x0()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m0x4()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m0x8()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m0x12()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m0x16()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m1x3()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m1x7()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m1x11()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m1x15()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m1x19()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m2x2()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m2x6()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m2x10()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m2x14()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m2x18()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m3x1()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m3x5()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m3x9()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m3x13()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m3x17()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m4x0()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m4x4()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m4x8()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m4x12()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m4x16()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m5x3()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m5x7()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m5x11()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m5x15()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m5x19()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m6x2()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m6x6()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m6x10()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m6x14()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m6x18()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m7x1()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m7x5()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m7x9()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m7x13()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m7x17()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m8x0()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m8x4()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m8x8()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m8x12()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m8x16()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m9x3()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m9x7()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m9x11()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m9x15()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m9x19()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m10x2()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m10x6()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m10x10()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m10x14()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m10x18()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m11x1()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m11x5()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m11x9()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m11x13()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m11x17()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m12x0()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m12x4()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m12x8()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m12x12()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m12x16()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m13x3()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m13x7()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m13x11()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m13x15()) + ","; } catch (e) { s += e.constructor.name; }
      try { s += String(this.m13x19()) + ","; } catch (e) { s += e.constructor.name; }
    }
    return s;
  }
}
class Outer { constructor(list) { this.list = list; } run() { let s = ""; for (let i = 0; i < this.list.length; i++) s += this.list[i].scan(3); return s; } }
globalThis.kept = [Scanner, Outer];
if (process.argv[9]) new Scanner()[process.argv[9]] = 1;
const show = (t, f) => { let q; try { q = String(f()); } catch (e) { q = e.constructor.name; } out.push(t + " " + q); };
{ const k = 0; show("r0", () => new Outer([new Scanner("abc\u00e9"), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a0", () => o.scan(2)); o.input = "abc\u00e9"; show("b0", () => o.scan(2)); }
{ const k = 1; show("r1", () => new Outer([new Scanner("\u0436\u0443\u043a \ud83d\ude00"), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a1", () => o.scan(2)); o.input = "\u0436\u0443\u043a \ud83d\ude00"; show("b1", () => o.scan(2)); }
{ const k = 2; show("r2", () => new Outer([new Scanner(""), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a2", () => o.scan(2)); o.input = ""; show("b2", () => o.scan(2)); }
{ const k = 3; show("r3", () => new Outer([new Scanner("x".repeat(40)), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a3", () => o.scan(2)); o.input = "x".repeat(40); show("b3", () => o.scan(2)); }
{ const k = 4; show("r4", () => new Outer([new Scanner(("rope" + String(k) + "end")), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a4", () => o.scan(2)); o.input = ("rope" + String(k) + "end"); show("b4", () => o.scan(2)); }
{ const k = 5; show("r5", () => new Outer([new Scanner("a long base string".slice(2, 9)), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a5", () => o.scan(2)); o.input = "a long base string".slice(2, 9); show("b5", () => o.scan(2)); }
{ const k = 6; show("r6", () => new Outer([new Scanner(new String("obj")), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a6", () => o.scan(2)); o.input = new String("obj"); show("b6", () => o.scan(2)); }
{ const k = 7; show("r7", () => new Outer([new Scanner(5), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a7", () => o.scan(2)); o.input = 5; show("b7", () => o.scan(2)); }
{ const k = 8; show("r8", () => new Outer([new Scanner(null), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a8", () => o.scan(2)); o.input = null; show("b8", () => o.scan(2)); }
{ const k = 9; show("r9", () => new Outer([new Scanner(undefined), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a9", () => o.scan(2)); o.input = undefined; show("b9", () => o.scan(2)); }
{ const k = 10; show("r10", () => new Outer([new Scanner({ charCodeAt(i) { n++; return i * 2; }, length: 3, codePointAt: () => -1, charAt: (i) => "q" + i }), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a10", () => o.scan(2)); o.input = { charCodeAt(i) { n++; return i * 2; }, length: 3, codePointAt: () => -1, charAt: (i) => "q" + i }; show("b10", () => o.scan(2)); }
{ const k = 11; show("r11", () => new Outer([new Scanner(["a", "b"]), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a11", () => o.scan(2)); o.input = ["a", "b"]; show("b11", () => o.scan(2)); }
{ const k = 12; show("r12", () => new Outer([new Scanner(Object.assign(() => 1, { charCodeAt: (i) => "fn" + i })), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a12", () => o.scan(2)); o.input = Object.assign(() => 1, { charCodeAt: (i) => "fn" + i }); show("b12", () => o.scan(2)); }
{ const k = 13; show("r13", () => new Outer([new Scanner({ length: 2 }), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a13", () => o.scan(2)); o.input = { length: 2 }; show("b13", () => o.scan(2)); }
{ const k = 14; show("r14", () => new Outer([new Scanner(new Proxy({}, { get(t, k) { n++; return k === "length" ? 4 : () => 9; } })), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a14", () => o.scan(2)); o.input = new Proxy({}, { get(t, k) { n++; return k === "length" ? 4 : () => 9; } }); show("b14", () => o.scan(2)); }
{ const k = 15; show("r15", () => new Outer([new Scanner(true), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a15", () => o.scan(2)); o.input = true; show("b15", () => o.scan(2)); }
{ const k = 16; show("r16", () => new Outer([new Scanner(10n), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a16", () => o.scan(2)); o.input = 10n; show("b16", () => o.scan(2)); }
{ const k = 17; show("r17", () => new Outer([new Scanner(Symbol.iterator), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a17", () => o.scan(2)); o.input = Symbol.iterator; show("b17", () => o.scan(2)); }
{ const k = 18; show("r18", () => new Outer([new Scanner(class { static charCodeAt(i) { return i; } }), new Scanner("tail")]).run()); const o = new Scanner("switch"); show("a18", () => o.scan(2)); o.input = class { static charCodeAt(i) { return i; } }; show("b18", () => o.scan(2)); }
show("n", () => n);
for (const line of out) console.log(line.slice(0, 200), line.length, [...line].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 0));
