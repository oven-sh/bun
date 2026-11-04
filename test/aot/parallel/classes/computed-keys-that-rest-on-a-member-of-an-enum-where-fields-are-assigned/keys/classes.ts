// @ts-nocheck
import { Other } from "./other.ts";
enum E { Z, A = 21, S = "text", Computed = "ab".length, Later = A + 1 }
const enum C { A = 22 }
namespace N { export enum Inner { A = 23 } }
const alias = E.A;
class Above {}
const seen = new Set<string>();
function watch(name: string) { if (seen.has(name)) return; seen.add(name); Object.defineProperty(Above.prototype, name, { set(value) { console.log("  set", name); }, configurable: true }); }
watch("y");
const keys = (o: object) => Reflect.ownKeys(o).map(String).join("+") || "none";
try { watch(String(E.A)); } catch {}
class F1 extends Above { [E.A] = 1; y = 2; }
console.log(1, 'E.A', "field", keys(new F1()));
class S1 extends Above { static [E.A] = 1; y = 2; }
console.log(1, "static", keys(new S1()), keys(S1));
class M1 extends Above { [E.A]() {} y = 2; }
console.log(1, "method", keys(new M1()), keys(M1.prototype));
class G1 extends Above { get [E.A]() { return 1; } y = 2; }
console.log(1, "getter", keys(new G1()), keys(G1.prototype));
class A1 extends Above { accessor [E.A] = 1; y = 2; }
console.log(1, "accessor", keys(new A1()), keys(A1.prototype));
console.log(1, "literal", keys({ [E.A]: 1, y: 2 }), "pattern", (({ [E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(-E.A)); } catch {}
class F2 extends Above { [-E.A] = 1; y = 2; }
console.log(2, '-E.A', "field", keys(new F2()));
class S2 extends Above { static [-E.A] = 1; y = 2; }
console.log(2, "static", keys(new S2()), keys(S2));
class M2 extends Above { [-E.A]() {} y = 2; }
console.log(2, "method", keys(new M2()), keys(M2.prototype));
class G2 extends Above { get [-E.A]() { return 1; } y = 2; }
console.log(2, "getter", keys(new G2()), keys(G2.prototype));
class A2 extends Above { accessor [-E.A] = 1; y = 2; }
console.log(2, "accessor", keys(new A2()), keys(A2.prototype));
console.log(2, "literal", keys({ [-E.A]: 1, y: 2 }), "pattern", (({ [-E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(+E.A)); } catch {}
class F3 extends Above { [+E.A] = 1; y = 2; }
console.log(3, '+E.A', "field", keys(new F3()));
class S3 extends Above { static [+E.A] = 1; y = 2; }
console.log(3, "static", keys(new S3()), keys(S3));
class M3 extends Above { [+E.A]() {} y = 2; }
console.log(3, "method", keys(new M3()), keys(M3.prototype));
class G3 extends Above { get [+E.A]() { return 1; } y = 2; }
console.log(3, "getter", keys(new G3()), keys(G3.prototype));
class A3 extends Above { accessor [+E.A] = 1; y = 2; }
console.log(3, "accessor", keys(new A3()), keys(A3.prototype));
console.log(3, "literal", keys({ [+E.A]: 1, y: 2 }), "pattern", (({ [+E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(~E.A)); } catch {}
class F4 extends Above { [~E.A] = 1; y = 2; }
console.log(4, '~E.A', "field", keys(new F4()));
class S4 extends Above { static [~E.A] = 1; y = 2; }
console.log(4, "static", keys(new S4()), keys(S4));
class M4 extends Above { [~E.A]() {} y = 2; }
console.log(4, "method", keys(new M4()), keys(M4.prototype));
class G4 extends Above { get [~E.A]() { return 1; } y = 2; }
console.log(4, "getter", keys(new G4()), keys(G4.prototype));
class A4 extends Above { accessor [~E.A] = 1; y = 2; }
console.log(4, "accessor", keys(new A4()), keys(A4.prototype));
console.log(4, "literal", keys({ [~E.A]: 1, y: 2 }), "pattern", (({ [~E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(- -E.A)); } catch {}
class F5 extends Above { [- -E.A] = 1; y = 2; }
console.log(5, '- -E.A', "field", keys(new F5()));
class S5 extends Above { static [- -E.A] = 1; y = 2; }
console.log(5, "static", keys(new S5()), keys(S5));
class M5 extends Above { [- -E.A]() {} y = 2; }
console.log(5, "method", keys(new M5()), keys(M5.prototype));
class G5 extends Above { get [- -E.A]() { return 1; } y = 2; }
console.log(5, "getter", keys(new G5()), keys(G5.prototype));
class A5 extends Above { accessor [- -E.A] = 1; y = 2; }
console.log(5, "accessor", keys(new A5()), keys(A5.prototype));
console.log(5, "literal", keys({ [- -E.A]: 1, y: 2 }), "pattern", (({ [- -E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A + 0)); } catch {}
class F6 extends Above { [E.A + 0] = 1; y = 2; }
console.log(6, 'E.A + 0', "field", keys(new F6()));
class S6 extends Above { static [E.A + 0] = 1; y = 2; }
console.log(6, "static", keys(new S6()), keys(S6));
class M6 extends Above { [E.A + 0]() {} y = 2; }
console.log(6, "method", keys(new M6()), keys(M6.prototype));
class G6 extends Above { get [E.A + 0]() { return 1; } y = 2; }
console.log(6, "getter", keys(new G6()), keys(G6.prototype));
class A6 extends Above { accessor [E.A + 0] = 1; y = 2; }
console.log(6, "accessor", keys(new A6()), keys(A6.prototype));
console.log(6, "literal", keys({ [E.A + 0]: 1, y: 2 }), "pattern", (({ [E.A + 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(0 + E.A)); } catch {}
class F7 extends Above { [0 + E.A] = 1; y = 2; }
console.log(7, '0 + E.A', "field", keys(new F7()));
class S7 extends Above { static [0 + E.A] = 1; y = 2; }
console.log(7, "static", keys(new S7()), keys(S7));
class M7 extends Above { [0 + E.A]() {} y = 2; }
console.log(7, "method", keys(new M7()), keys(M7.prototype));
class G7 extends Above { get [0 + E.A]() { return 1; } y = 2; }
console.log(7, "getter", keys(new G7()), keys(G7.prototype));
class A7 extends Above { accessor [0 + E.A] = 1; y = 2; }
console.log(7, "accessor", keys(new A7()), keys(A7.prototype));
console.log(7, "literal", keys({ [0 + E.A]: 1, y: 2 }), "pattern", (({ [0 + E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A * 1)); } catch {}
class F8 extends Above { [E.A * 1] = 1; y = 2; }
console.log(8, 'E.A * 1', "field", keys(new F8()));
class S8 extends Above { static [E.A * 1] = 1; y = 2; }
console.log(8, "static", keys(new S8()), keys(S8));
class M8 extends Above { [E.A * 1]() {} y = 2; }
console.log(8, "method", keys(new M8()), keys(M8.prototype));
class G8 extends Above { get [E.A * 1]() { return 1; } y = 2; }
console.log(8, "getter", keys(new G8()), keys(G8.prototype));
class A8 extends Above { accessor [E.A * 1] = 1; y = 2; }
console.log(8, "accessor", keys(new A8()), keys(A8.prototype));
console.log(8, "literal", keys({ [E.A * 1]: 1, y: 2 }), "pattern", (({ [E.A * 1]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A | 0)); } catch {}
class F9 extends Above { [E.A | 0] = 1; y = 2; }
console.log(9, 'E.A | 0', "field", keys(new F9()));
class S9 extends Above { static [E.A | 0] = 1; y = 2; }
console.log(9, "static", keys(new S9()), keys(S9));
class M9 extends Above { [E.A | 0]() {} y = 2; }
console.log(9, "method", keys(new M9()), keys(M9.prototype));
class G9 extends Above { get [E.A | 0]() { return 1; } y = 2; }
console.log(9, "getter", keys(new G9()), keys(G9.prototype));
class A9 extends Above { accessor [E.A | 0] = 1; y = 2; }
console.log(9, "accessor", keys(new A9()), keys(A9.prototype));
console.log(9, "literal", keys({ [E.A | 0]: 1, y: 2 }), "pattern", (({ [E.A | 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? E.A : 0)); } catch {}
class F10 extends Above { [true ? E.A : 0] = 1; y = 2; }
console.log(10, 'true ? E.A : 0', "field", keys(new F10()));
class S10 extends Above { static [true ? E.A : 0] = 1; y = 2; }
console.log(10, "static", keys(new S10()), keys(S10));
class M10 extends Above { [true ? E.A : 0]() {} y = 2; }
console.log(10, "method", keys(new M10()), keys(M10.prototype));
class G10 extends Above { get [true ? E.A : 0]() { return 1; } y = 2; }
console.log(10, "getter", keys(new G10()), keys(G10.prototype));
class A10 extends Above { accessor [true ? E.A : 0] = 1; y = 2; }
console.log(10, "accessor", keys(new A10()), keys(A10.prototype));
console.log(10, "literal", keys({ [true ? E.A : 0]: 1, y: 2 }), "pattern", (({ [true ? E.A : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(false ? 0 : E.A)); } catch {}
class F11 extends Above { [false ? 0 : E.A] = 1; y = 2; }
console.log(11, 'false ? 0 : E.A', "field", keys(new F11()));
class S11 extends Above { static [false ? 0 : E.A] = 1; y = 2; }
console.log(11, "static", keys(new S11()), keys(S11));
class M11 extends Above { [false ? 0 : E.A]() {} y = 2; }
console.log(11, "method", keys(new M11()), keys(M11.prototype));
class G11 extends Above { get [false ? 0 : E.A]() { return 1; } y = 2; }
console.log(11, "getter", keys(new G11()), keys(G11.prototype));
class A11 extends Above { accessor [false ? 0 : E.A] = 1; y = 2; }
console.log(11, "accessor", keys(new A11()), keys(A11.prototype));
console.log(11, "literal", keys({ [false ? 0 : E.A]: 1, y: 2 }), "pattern", (({ [false ? 0 : E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(0 || E.A)); } catch {}
class F12 extends Above { [0 || E.A] = 1; y = 2; }
console.log(12, '0 || E.A', "field", keys(new F12()));
class S12 extends Above { static [0 || E.A] = 1; y = 2; }
console.log(12, "static", keys(new S12()), keys(S12));
class M12 extends Above { [0 || E.A]() {} y = 2; }
console.log(12, "method", keys(new M12()), keys(M12.prototype));
class G12 extends Above { get [0 || E.A]() { return 1; } y = 2; }
console.log(12, "getter", keys(new G12()), keys(G12.prototype));
class A12 extends Above { accessor [0 || E.A] = 1; y = 2; }
console.log(12, "accessor", keys(new A12()), keys(A12.prototype));
console.log(12, "literal", keys({ [0 || E.A]: 1, y: 2 }), "pattern", (({ [0 || E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A || 0)); } catch {}
class F13 extends Above { [E.A || 0] = 1; y = 2; }
console.log(13, 'E.A || 0', "field", keys(new F13()));
class S13 extends Above { static [E.A || 0] = 1; y = 2; }
console.log(13, "static", keys(new S13()), keys(S13));
class M13 extends Above { [E.A || 0]() {} y = 2; }
console.log(13, "method", keys(new M13()), keys(M13.prototype));
class G13 extends Above { get [E.A || 0]() { return 1; } y = 2; }
console.log(13, "getter", keys(new G13()), keys(G13.prototype));
class A13 extends Above { accessor [E.A || 0] = 1; y = 2; }
console.log(13, "accessor", keys(new A13()), keys(A13.prototype));
console.log(13, "literal", keys({ [E.A || 0]: 1, y: 2 }), "pattern", (({ [E.A || 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(1 && E.A)); } catch {}
class F14 extends Above { [1 && E.A] = 1; y = 2; }
console.log(14, '1 && E.A', "field", keys(new F14()));
class S14 extends Above { static [1 && E.A] = 1; y = 2; }
console.log(14, "static", keys(new S14()), keys(S14));
class M14 extends Above { [1 && E.A]() {} y = 2; }
console.log(14, "method", keys(new M14()), keys(M14.prototype));
class G14 extends Above { get [1 && E.A]() { return 1; } y = 2; }
console.log(14, "getter", keys(new G14()), keys(G14.prototype));
class A14 extends Above { accessor [1 && E.A] = 1; y = 2; }
console.log(14, "accessor", keys(new A14()), keys(A14.prototype));
console.log(14, "literal", keys({ [1 && E.A]: 1, y: 2 }), "pattern", (({ [1 && E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.Z && 1)); } catch {}
class F15 extends Above { [E.Z && 1] = 1; y = 2; }
console.log(15, 'E.Z && 1', "field", keys(new F15()));
class S15 extends Above { static [E.Z && 1] = 1; y = 2; }
console.log(15, "static", keys(new S15()), keys(S15));
class M15 extends Above { [E.Z && 1]() {} y = 2; }
console.log(15, "method", keys(new M15()), keys(M15.prototype));
class G15 extends Above { get [E.Z && 1]() { return 1; } y = 2; }
console.log(15, "getter", keys(new G15()), keys(G15.prototype));
class A15 extends Above { accessor [E.Z && 1] = 1; y = 2; }
console.log(15, "accessor", keys(new A15()), keys(A15.prototype));
console.log(15, "literal", keys({ [E.Z && 1]: 1, y: 2 }), "pattern", (({ [E.Z && 1]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(null ?? E.A)); } catch {}
class F16 extends Above { [null ?? E.A] = 1; y = 2; }
console.log(16, 'null ?? E.A', "field", keys(new F16()));
class S16 extends Above { static [null ?? E.A] = 1; y = 2; }
console.log(16, "static", keys(new S16()), keys(S16));
class M16 extends Above { [null ?? E.A]() {} y = 2; }
console.log(16, "method", keys(new M16()), keys(M16.prototype));
class G16 extends Above { get [null ?? E.A]() { return 1; } y = 2; }
console.log(16, "getter", keys(new G16()), keys(G16.prototype));
class A16 extends Above { accessor [null ?? E.A] = 1; y = 2; }
console.log(16, "accessor", keys(new A16()), keys(A16.prototype));
console.log(16, "literal", keys({ [null ?? E.A]: 1, y: 2 }), "pattern", (({ [null ?? E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A ?? 0)); } catch {}
class F17 extends Above { [E.A ?? 0] = 1; y = 2; }
console.log(17, 'E.A ?? 0', "field", keys(new F17()));
class S17 extends Above { static [E.A ?? 0] = 1; y = 2; }
console.log(17, "static", keys(new S17()), keys(S17));
class M17 extends Above { [E.A ?? 0]() {} y = 2; }
console.log(17, "method", keys(new M17()), keys(M17.prototype));
class G17 extends Above { get [E.A ?? 0]() { return 1; } y = 2; }
console.log(17, "getter", keys(new G17()), keys(G17.prototype));
class A17 extends Above { accessor [E.A ?? 0] = 1; y = 2; }
console.log(17, "accessor", keys(new A17()), keys(A17.prototype));
console.log(17, "literal", keys({ [E.A ?? 0]: 1, y: 2 }), "pattern", (({ [E.A ?? 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String((0, E.A))); } catch {}
class F18 extends Above { [(0, E.A)] = 1; y = 2; }
console.log(18, '(0, E.A)', "field", keys(new F18()));
class S18 extends Above { static [(0, E.A)] = 1; y = 2; }
console.log(18, "static", keys(new S18()), keys(S18));
class M18 extends Above { [(0, E.A)]() {} y = 2; }
console.log(18, "method", keys(new M18()), keys(M18.prototype));
class G18 extends Above { get [(0, E.A)]() { return 1; } y = 2; }
console.log(18, "getter", keys(new G18()), keys(G18.prototype));
class A18 extends Above { accessor [(0, E.A)] = 1; y = 2; }
console.log(18, "accessor", keys(new A18()), keys(A18.prototype));
console.log(18, "literal", keys({ [(0, E.A)]: 1, y: 2 }), "pattern", (({ [(0, E.A)]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String((E.A))); } catch {}
class F19 extends Above { [(E.A)] = 1; y = 2; }
console.log(19, '(E.A)', "field", keys(new F19()));
class S19 extends Above { static [(E.A)] = 1; y = 2; }
console.log(19, "static", keys(new S19()), keys(S19));
class M19 extends Above { [(E.A)]() {} y = 2; }
console.log(19, "method", keys(new M19()), keys(M19.prototype));
class G19 extends Above { get [(E.A)]() { return 1; } y = 2; }
console.log(19, "getter", keys(new G19()), keys(G19.prototype));
class A19 extends Above { accessor [(E.A)] = 1; y = 2; }
console.log(19, "accessor", keys(new A19()), keys(A19.prototype));
console.log(19, "literal", keys({ [(E.A)]: 1, y: 2 }), "pattern", (({ [(E.A)]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(((E.A)))); } catch {}
class F20 extends Above { [((E.A))] = 1; y = 2; }
console.log(20, '((E.A))', "field", keys(new F20()));
class S20 extends Above { static [((E.A))] = 1; y = 2; }
console.log(20, "static", keys(new S20()), keys(S20));
class M20 extends Above { [((E.A))]() {} y = 2; }
console.log(20, "method", keys(new M20()), keys(M20.prototype));
class G20 extends Above { get [((E.A))]() { return 1; } y = 2; }
console.log(20, "getter", keys(new G20()), keys(G20.prototype));
class A20 extends Above { accessor [((E.A))] = 1; y = 2; }
console.log(20, "accessor", keys(new A20()), keys(A20.prototype));
console.log(20, "literal", keys({ [((E.A))]: 1, y: 2 }), "pattern", (({ [((E.A))]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String([E.A][0])); } catch {}
class F21 extends Above { [[E.A][0]] = 1; y = 2; }
console.log(21, '[E.A][0]', "field", keys(new F21()));
class S21 extends Above { static [[E.A][0]] = 1; y = 2; }
console.log(21, "static", keys(new S21()), keys(S21));
class M21 extends Above { [[E.A][0]]() {} y = 2; }
console.log(21, "method", keys(new M21()), keys(M21.prototype));
class G21 extends Above { get [[E.A][0]]() { return 1; } y = 2; }
console.log(21, "getter", keys(new G21()), keys(G21.prototype));
class A21 extends Above { accessor [[E.A][0]] = 1; y = 2; }
console.log(21, "accessor", keys(new A21()), keys(A21.prototype));
console.log(21, "literal", keys({ [[E.A][0]]: 1, y: 2 }), "pattern", (({ [[E.A][0]]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(typeof E.A)); } catch {}
class F22 extends Above { [typeof E.A] = 1; y = 2; }
console.log(22, 'typeof E.A', "field", keys(new F22()));
class S22 extends Above { static [typeof E.A] = 1; y = 2; }
console.log(22, "static", keys(new S22()), keys(S22));
class M22 extends Above { [typeof E.A]() {} y = 2; }
console.log(22, "method", keys(new M22()), keys(M22.prototype));
class G22 extends Above { get [typeof E.A]() { return 1; } y = 2; }
console.log(22, "getter", keys(new G22()), keys(G22.prototype));
class A22 extends Above { accessor [typeof E.A] = 1; y = 2; }
console.log(22, "accessor", keys(new A22()), keys(A22.prototype));
console.log(22, "literal", keys({ [typeof E.A]: 1, y: 2 }), "pattern", (({ [typeof E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(typeof (true ? E.A : 0))); } catch {}
class F23 extends Above { [typeof (true ? E.A : 0)] = 1; y = 2; }
console.log(23, 'typeof (true ? E.A : 0)', "field", keys(new F23()));
class S23 extends Above { static [typeof (true ? E.A : 0)] = 1; y = 2; }
console.log(23, "static", keys(new S23()), keys(S23));
class M23 extends Above { [typeof (true ? E.A : 0)]() {} y = 2; }
console.log(23, "method", keys(new M23()), keys(M23.prototype));
class G23 extends Above { get [typeof (true ? E.A : 0)]() { return 1; } y = 2; }
console.log(23, "getter", keys(new G23()), keys(G23.prototype));
class A23 extends Above { accessor [typeof (true ? E.A : 0)] = 1; y = 2; }
console.log(23, "accessor", keys(new A23()), keys(A23.prototype));
console.log(23, "literal", keys({ [typeof (true ? E.A : 0)]: 1, y: 2 }), "pattern", (({ [typeof (true ? E.A : 0)]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(`${E.A}`)); } catch {}
class F24 extends Above { [`${E.A}`] = 1; y = 2; }
console.log(24, '`${E.A}`', "field", keys(new F24()));
class S24 extends Above { static [`${E.A}`] = 1; y = 2; }
console.log(24, "static", keys(new S24()), keys(S24));
class M24 extends Above { [`${E.A}`]() {} y = 2; }
console.log(24, "method", keys(new M24()), keys(M24.prototype));
class G24 extends Above { get [`${E.A}`]() { return 1; } y = 2; }
console.log(24, "getter", keys(new G24()), keys(G24.prototype));
class A24 extends Above { accessor [`${E.A}`] = 1; y = 2; }
console.log(24, "accessor", keys(new A24()), keys(A24.prototype));
console.log(24, "literal", keys({ [`${E.A}`]: 1, y: 2 }), "pattern", (({ [`${E.A}`]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(`a${E.A}`)); } catch {}
class F25 extends Above { [`a${E.A}`] = 1; y = 2; }
console.log(25, '`a${E.A}`', "field", keys(new F25()));
class S25 extends Above { static [`a${E.A}`] = 1; y = 2; }
console.log(25, "static", keys(new S25()), keys(S25));
class M25 extends Above { [`a${E.A}`]() {} y = 2; }
console.log(25, "method", keys(new M25()), keys(M25.prototype));
class G25 extends Above { get [`a${E.A}`]() { return 1; } y = 2; }
console.log(25, "getter", keys(new G25()), keys(G25.prototype));
class A25 extends Above { accessor [`a${E.A}`] = 1; y = 2; }
console.log(25, "accessor", keys(new A25()), keys(A25.prototype));
console.log(25, "literal", keys({ [`a${E.A}`]: 1, y: 2 }), "pattern", (({ [`a${E.A}`]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A as number)); } catch {}
class F26 extends Above { [E.A as number] = 1; y = 2; }
console.log(26, 'E.A as number', "field", keys(new F26()));
class S26 extends Above { static [E.A as number] = 1; y = 2; }
console.log(26, "static", keys(new S26()), keys(S26));
class M26 extends Above { [E.A as number]() {} y = 2; }
console.log(26, "method", keys(new M26()), keys(M26.prototype));
class G26 extends Above { get [E.A as number]() { return 1; } y = 2; }
console.log(26, "getter", keys(new G26()), keys(G26.prototype));
class A26 extends Above { accessor [E.A as number] = 1; y = 2; }
console.log(26, "accessor", keys(new A26()), keys(A26.prototype));
console.log(26, "literal", keys({ [E.A as number]: 1, y: 2 }), "pattern", (({ [E.A as number]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(<number>E.A)); } catch {}
class F27 extends Above { [<number>E.A] = 1; y = 2; }
console.log(27, '<number>E.A', "field", keys(new F27()));
class S27 extends Above { static [<number>E.A] = 1; y = 2; }
console.log(27, "static", keys(new S27()), keys(S27));
class M27 extends Above { [<number>E.A]() {} y = 2; }
console.log(27, "method", keys(new M27()), keys(M27.prototype));
class G27 extends Above { get [<number>E.A]() { return 1; } y = 2; }
console.log(27, "getter", keys(new G27()), keys(G27.prototype));
class A27 extends Above { accessor [<number>E.A] = 1; y = 2; }
console.log(27, "accessor", keys(new A27()), keys(A27.prototype));
console.log(27, "literal", keys({ [<number>E.A]: 1, y: 2 }), "pattern", (({ [<number>E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A!)); } catch {}
class F28 extends Above { [E.A!] = 1; y = 2; }
console.log(28, 'E.A!', "field", keys(new F28()));
class S28 extends Above { static [E.A!] = 1; y = 2; }
console.log(28, "static", keys(new S28()), keys(S28));
class M28 extends Above { [E.A!]() {} y = 2; }
console.log(28, "method", keys(new M28()), keys(M28.prototype));
class G28 extends Above { get [E.A!]() { return 1; } y = 2; }
console.log(28, "getter", keys(new G28()), keys(G28.prototype));
class A28 extends Above { accessor [E.A!] = 1; y = 2; }
console.log(28, "accessor", keys(new A28()), keys(A28.prototype));
console.log(28, "literal", keys({ [E.A!]: 1, y: 2 }), "pattern", (({ [E.A!]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A satisfies number)); } catch {}
class F29 extends Above { [E.A satisfies number] = 1; y = 2; }
console.log(29, 'E.A satisfies number', "field", keys(new F29()));
class S29 extends Above { static [E.A satisfies number] = 1; y = 2; }
console.log(29, "static", keys(new S29()), keys(S29));
class M29 extends Above { [E.A satisfies number]() {} y = 2; }
console.log(29, "method", keys(new M29()), keys(M29.prototype));
class G29 extends Above { get [E.A satisfies number]() { return 1; } y = 2; }
console.log(29, "getter", keys(new G29()), keys(G29.prototype));
class A29 extends Above { accessor [E.A satisfies number] = 1; y = 2; }
console.log(29, "accessor", keys(new A29()), keys(A29.prototype));
console.log(29, "literal", keys({ [E.A satisfies number]: 1, y: 2 }), "pattern", (({ [E.A satisfies number]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E["A"])); } catch {}
class F30 extends Above { [E["A"]] = 1; y = 2; }
console.log(30, 'E["A"]', "field", keys(new F30()));
class S30 extends Above { static [E["A"]] = 1; y = 2; }
console.log(30, "static", keys(new S30()), keys(S30));
class M30 extends Above { [E["A"]]() {} y = 2; }
console.log(30, "method", keys(new M30()), keys(M30.prototype));
class G30 extends Above { get [E["A"]]() { return 1; } y = 2; }
console.log(30, "getter", keys(new G30()), keys(G30.prototype));
class A30 extends Above { accessor [E["A"]] = 1; y = 2; }
console.log(30, "accessor", keys(new A30()), keys(A30.prototype));
console.log(30, "literal", keys({ [E["A"]]: 1, y: 2 }), "pattern", (({ [E["A"]]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E[`A`])); } catch {}
class F31 extends Above { [E[`A`]] = 1; y = 2; }
console.log(31, 'E[`A`]', "field", keys(new F31()));
class S31 extends Above { static [E[`A`]] = 1; y = 2; }
console.log(31, "static", keys(new S31()), keys(S31));
class M31 extends Above { [E[`A`]]() {} y = 2; }
console.log(31, "method", keys(new M31()), keys(M31.prototype));
class G31 extends Above { get [E[`A`]]() { return 1; } y = 2; }
console.log(31, "getter", keys(new G31()), keys(G31.prototype));
class A31 extends Above { accessor [E[`A`]] = 1; y = 2; }
console.log(31, "accessor", keys(new A31()), keys(A31.prototype));
console.log(31, "literal", keys({ [E[`A`]]: 1, y: 2 }), "pattern", (({ [E[`A`]]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.S)); } catch {}
class F32 extends Above { [E.S] = 1; y = 2; }
console.log(32, 'E.S', "field", keys(new F32()));
class S32 extends Above { static [E.S] = 1; y = 2; }
console.log(32, "static", keys(new S32()), keys(S32));
class M32 extends Above { [E.S]() {} y = 2; }
console.log(32, "method", keys(new M32()), keys(M32.prototype));
class G32 extends Above { get [E.S]() { return 1; } y = 2; }
console.log(32, "getter", keys(new G32()), keys(G32.prototype));
class A32 extends Above { accessor [E.S] = 1; y = 2; }
console.log(32, "accessor", keys(new A32()), keys(A32.prototype));
console.log(32, "literal", keys({ [E.S]: 1, y: 2 }), "pattern", (({ [E.S]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.S + "")); } catch {}
class F33 extends Above { [E.S + ""] = 1; y = 2; }
console.log(33, 'E.S + ""', "field", keys(new F33()));
class S33 extends Above { static [E.S + ""] = 1; y = 2; }
console.log(33, "static", keys(new S33()), keys(S33));
class M33 extends Above { [E.S + ""]() {} y = 2; }
console.log(33, "method", keys(new M33()), keys(M33.prototype));
class G33 extends Above { get [E.S + ""]() { return 1; } y = 2; }
console.log(33, "getter", keys(new G33()), keys(G33.prototype));
class A33 extends Above { accessor [E.S + ""] = 1; y = 2; }
console.log(33, "accessor", keys(new A33()), keys(A33.prototype));
console.log(33, "literal", keys({ [E.S + ""]: 1, y: 2 }), "pattern", (({ [E.S + ""]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String("" + E.S)); } catch {}
class F34 extends Above { ["" + E.S] = 1; y = 2; }
console.log(34, '"" + E.S', "field", keys(new F34()));
class S34 extends Above { static ["" + E.S] = 1; y = 2; }
console.log(34, "static", keys(new S34()), keys(S34));
class M34 extends Above { ["" + E.S]() {} y = 2; }
console.log(34, "method", keys(new M34()), keys(M34.prototype));
class G34 extends Above { get ["" + E.S]() { return 1; } y = 2; }
console.log(34, "getter", keys(new G34()), keys(G34.prototype));
class A34 extends Above { accessor ["" + E.S] = 1; y = 2; }
console.log(34, "accessor", keys(new A34()), keys(A34.prototype));
console.log(34, "literal", keys({ ["" + E.S]: 1, y: 2 }), "pattern", (({ ["" + E.S]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? E.S : "")); } catch {}
class F35 extends Above { [true ? E.S : ""] = 1; y = 2; }
console.log(35, 'true ? E.S : ""', "field", keys(new F35()));
class S35 extends Above { static [true ? E.S : ""] = 1; y = 2; }
console.log(35, "static", keys(new S35()), keys(S35));
class M35 extends Above { [true ? E.S : ""]() {} y = 2; }
console.log(35, "method", keys(new M35()), keys(M35.prototype));
class G35 extends Above { get [true ? E.S : ""]() { return 1; } y = 2; }
console.log(35, "getter", keys(new G35()), keys(G35.prototype));
class A35 extends Above { accessor [true ? E.S : ""] = 1; y = 2; }
console.log(35, "accessor", keys(new A35()), keys(A35.prototype));
console.log(35, "literal", keys({ [true ? E.S : ""]: 1, y: 2 }), "pattern", (({ [true ? E.S : ""]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String("" || E.S)); } catch {}
class F36 extends Above { ["" || E.S] = 1; y = 2; }
console.log(36, '"" || E.S', "field", keys(new F36()));
class S36 extends Above { static ["" || E.S] = 1; y = 2; }
console.log(36, "static", keys(new S36()), keys(S36));
class M36 extends Above { ["" || E.S]() {} y = 2; }
console.log(36, "method", keys(new M36()), keys(M36.prototype));
class G36 extends Above { get ["" || E.S]() { return 1; } y = 2; }
console.log(36, "getter", keys(new G36()), keys(G36.prototype));
class A36 extends Above { accessor ["" || E.S] = 1; y = 2; }
console.log(36, "accessor", keys(new A36()), keys(A36.prototype));
console.log(36, "literal", keys({ ["" || E.S]: 1, y: 2 }), "pattern", (({ ["" || E.S]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(`${E.S}`)); } catch {}
class F37 extends Above { [`${E.S}`] = 1; y = 2; }
console.log(37, '`${E.S}`', "field", keys(new F37()));
class S37 extends Above { static [`${E.S}`] = 1; y = 2; }
console.log(37, "static", keys(new S37()), keys(S37));
class M37 extends Above { [`${E.S}`]() {} y = 2; }
console.log(37, "method", keys(new M37()), keys(M37.prototype));
class G37 extends Above { get [`${E.S}`]() { return 1; } y = 2; }
console.log(37, "getter", keys(new G37()), keys(G37.prototype));
class A37 extends Above { accessor [`${E.S}`] = 1; y = 2; }
console.log(37, "accessor", keys(new A37()), keys(A37.prototype));
console.log(37, "literal", keys({ [`${E.S}`]: 1, y: 2 }), "pattern", (({ [`${E.S}`]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.S.length)); } catch {}
class F38 extends Above { [E.S.length] = 1; y = 2; }
console.log(38, 'E.S.length', "field", keys(new F38()));
class S38 extends Above { static [E.S.length] = 1; y = 2; }
console.log(38, "static", keys(new S38()), keys(S38));
class M38 extends Above { [E.S.length]() {} y = 2; }
console.log(38, "method", keys(new M38()), keys(M38.prototype));
class G38 extends Above { get [E.S.length]() { return 1; } y = 2; }
console.log(38, "getter", keys(new G38()), keys(G38.prototype));
class A38 extends Above { accessor [E.S.length] = 1; y = 2; }
console.log(38, "accessor", keys(new A38()), keys(A38.prototype));
console.log(38, "literal", keys({ [E.S.length]: 1, y: 2 }), "pattern", (({ [E.S.length]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.S[0])); } catch {}
class F39 extends Above { [E.S[0]] = 1; y = 2; }
console.log(39, 'E.S[0]', "field", keys(new F39()));
class S39 extends Above { static [E.S[0]] = 1; y = 2; }
console.log(39, "static", keys(new S39()), keys(S39));
class M39 extends Above { [E.S[0]]() {} y = 2; }
console.log(39, "method", keys(new M39()), keys(M39.prototype));
class G39 extends Above { get [E.S[0]]() { return 1; } y = 2; }
console.log(39, "getter", keys(new G39()), keys(G39.prototype));
class A39 extends Above { accessor [E.S[0]] = 1; y = 2; }
console.log(39, "accessor", keys(new A39()), keys(A39.prototype));
console.log(39, "literal", keys({ [E.S[0]]: 1, y: 2 }), "pattern", (({ [E.S[0]]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(C.A)); } catch {}
class F40 extends Above { [C.A] = 1; y = 2; }
console.log(40, 'C.A', "field", keys(new F40()));
class S40 extends Above { static [C.A] = 1; y = 2; }
console.log(40, "static", keys(new S40()), keys(S40));
class M40 extends Above { [C.A]() {} y = 2; }
console.log(40, "method", keys(new M40()), keys(M40.prototype));
class G40 extends Above { get [C.A]() { return 1; } y = 2; }
console.log(40, "getter", keys(new G40()), keys(G40.prototype));
class A40 extends Above { accessor [C.A] = 1; y = 2; }
console.log(40, "accessor", keys(new A40()), keys(A40.prototype));
console.log(40, "literal", keys({ [C.A]: 1, y: 2 }), "pattern", (({ [C.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(-C.A)); } catch {}
class F41 extends Above { [-C.A] = 1; y = 2; }
console.log(41, '-C.A', "field", keys(new F41()));
class S41 extends Above { static [-C.A] = 1; y = 2; }
console.log(41, "static", keys(new S41()), keys(S41));
class M41 extends Above { [-C.A]() {} y = 2; }
console.log(41, "method", keys(new M41()), keys(M41.prototype));
class G41 extends Above { get [-C.A]() { return 1; } y = 2; }
console.log(41, "getter", keys(new G41()), keys(G41.prototype));
class A41 extends Above { accessor [-C.A] = 1; y = 2; }
console.log(41, "accessor", keys(new A41()), keys(A41.prototype));
console.log(41, "literal", keys({ [-C.A]: 1, y: 2 }), "pattern", (({ [-C.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? C.A : 0)); } catch {}
class F42 extends Above { [true ? C.A : 0] = 1; y = 2; }
console.log(42, 'true ? C.A : 0', "field", keys(new F42()));
class S42 extends Above { static [true ? C.A : 0] = 1; y = 2; }
console.log(42, "static", keys(new S42()), keys(S42));
class M42 extends Above { [true ? C.A : 0]() {} y = 2; }
console.log(42, "method", keys(new M42()), keys(M42.prototype));
class G42 extends Above { get [true ? C.A : 0]() { return 1; } y = 2; }
console.log(42, "getter", keys(new G42()), keys(G42.prototype));
class A42 extends Above { accessor [true ? C.A : 0] = 1; y = 2; }
console.log(42, "accessor", keys(new A42()), keys(A42.prototype));
console.log(42, "literal", keys({ [true ? C.A : 0]: 1, y: 2 }), "pattern", (({ [true ? C.A : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(0 || C.A)); } catch {}
class F43 extends Above { [0 || C.A] = 1; y = 2; }
console.log(43, '0 || C.A', "field", keys(new F43()));
class S43 extends Above { static [0 || C.A] = 1; y = 2; }
console.log(43, "static", keys(new S43()), keys(S43));
class M43 extends Above { [0 || C.A]() {} y = 2; }
console.log(43, "method", keys(new M43()), keys(M43.prototype));
class G43 extends Above { get [0 || C.A]() { return 1; } y = 2; }
console.log(43, "getter", keys(new G43()), keys(G43.prototype));
class A43 extends Above { accessor [0 || C.A] = 1; y = 2; }
console.log(43, "accessor", keys(new A43()), keys(A43.prototype));
console.log(43, "literal", keys({ [0 || C.A]: 1, y: 2 }), "pattern", (({ [0 || C.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(C.A + 0)); } catch {}
class F44 extends Above { [C.A + 0] = 1; y = 2; }
console.log(44, 'C.A + 0', "field", keys(new F44()));
class S44 extends Above { static [C.A + 0] = 1; y = 2; }
console.log(44, "static", keys(new S44()), keys(S44));
class M44 extends Above { [C.A + 0]() {} y = 2; }
console.log(44, "method", keys(new M44()), keys(M44.prototype));
class G44 extends Above { get [C.A + 0]() { return 1; } y = 2; }
console.log(44, "getter", keys(new G44()), keys(G44.prototype));
class A44 extends Above { accessor [C.A + 0] = 1; y = 2; }
console.log(44, "accessor", keys(new A44()), keys(A44.prototype));
console.log(44, "literal", keys({ [C.A + 0]: 1, y: 2 }), "pattern", (({ [C.A + 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(Other.A)); } catch {}
class F45 extends Above { [Other.A] = 1; y = 2; }
console.log(45, 'Other.A', "field", keys(new F45()));
class S45 extends Above { static [Other.A] = 1; y = 2; }
console.log(45, "static", keys(new S45()), keys(S45));
class M45 extends Above { [Other.A]() {} y = 2; }
console.log(45, "method", keys(new M45()), keys(M45.prototype));
class G45 extends Above { get [Other.A]() { return 1; } y = 2; }
console.log(45, "getter", keys(new G45()), keys(G45.prototype));
class A45 extends Above { accessor [Other.A] = 1; y = 2; }
console.log(45, "accessor", keys(new A45()), keys(A45.prototype));
console.log(45, "literal", keys({ [Other.A]: 1, y: 2 }), "pattern", (({ [Other.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? Other.A : 0)); } catch {}
class F46 extends Above { [true ? Other.A : 0] = 1; y = 2; }
console.log(46, 'true ? Other.A : 0', "field", keys(new F46()));
class S46 extends Above { static [true ? Other.A : 0] = 1; y = 2; }
console.log(46, "static", keys(new S46()), keys(S46));
class M46 extends Above { [true ? Other.A : 0]() {} y = 2; }
console.log(46, "method", keys(new M46()), keys(M46.prototype));
class G46 extends Above { get [true ? Other.A : 0]() { return 1; } y = 2; }
console.log(46, "getter", keys(new G46()), keys(G46.prototype));
class A46 extends Above { accessor [true ? Other.A : 0] = 1; y = 2; }
console.log(46, "accessor", keys(new A46()), keys(A46.prototype));
console.log(46, "literal", keys({ [true ? Other.A : 0]: 1, y: 2 }), "pattern", (({ [true ? Other.A : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(-Other.A)); } catch {}
class F47 extends Above { [-Other.A] = 1; y = 2; }
console.log(47, '-Other.A', "field", keys(new F47()));
class S47 extends Above { static [-Other.A] = 1; y = 2; }
console.log(47, "static", keys(new S47()), keys(S47));
class M47 extends Above { [-Other.A]() {} y = 2; }
console.log(47, "method", keys(new M47()), keys(M47.prototype));
class G47 extends Above { get [-Other.A]() { return 1; } y = 2; }
console.log(47, "getter", keys(new G47()), keys(G47.prototype));
class A47 extends Above { accessor [-Other.A] = 1; y = 2; }
console.log(47, "accessor", keys(new A47()), keys(A47.prototype));
console.log(47, "literal", keys({ [-Other.A]: 1, y: 2 }), "pattern", (({ [-Other.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(N.Inner.A)); } catch {}
class F48 extends Above { [N.Inner.A] = 1; y = 2; }
console.log(48, 'N.Inner.A', "field", keys(new F48()));
class S48 extends Above { static [N.Inner.A] = 1; y = 2; }
console.log(48, "static", keys(new S48()), keys(S48));
class M48 extends Above { [N.Inner.A]() {} y = 2; }
console.log(48, "method", keys(new M48()), keys(M48.prototype));
class G48 extends Above { get [N.Inner.A]() { return 1; } y = 2; }
console.log(48, "getter", keys(new G48()), keys(G48.prototype));
class A48 extends Above { accessor [N.Inner.A] = 1; y = 2; }
console.log(48, "accessor", keys(new A48()), keys(A48.prototype));
console.log(48, "literal", keys({ [N.Inner.A]: 1, y: 2 }), "pattern", (({ [N.Inner.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? N.Inner.A : 0)); } catch {}
class F49 extends Above { [true ? N.Inner.A : 0] = 1; y = 2; }
console.log(49, 'true ? N.Inner.A : 0', "field", keys(new F49()));
class S49 extends Above { static [true ? N.Inner.A : 0] = 1; y = 2; }
console.log(49, "static", keys(new S49()), keys(S49));
class M49 extends Above { [true ? N.Inner.A : 0]() {} y = 2; }
console.log(49, "method", keys(new M49()), keys(M49.prototype));
class G49 extends Above { get [true ? N.Inner.A : 0]() { return 1; } y = 2; }
console.log(49, "getter", keys(new G49()), keys(G49.prototype));
class A49 extends Above { accessor [true ? N.Inner.A : 0] = 1; y = 2; }
console.log(49, "accessor", keys(new A49()), keys(A49.prototype));
console.log(49, "literal", keys({ [true ? N.Inner.A : 0]: 1, y: 2 }), "pattern", (({ [true ? N.Inner.A : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(!E.A ? "x" : "z")); } catch {}
class F50 extends Above { [!E.A ? "x" : "z"] = 1; y = 2; }
console.log(50, '!E.A ? "x" : "z"', "field", keys(new F50()));
class S50 extends Above { static [!E.A ? "x" : "z"] = 1; y = 2; }
console.log(50, "static", keys(new S50()), keys(S50));
class M50 extends Above { [!E.A ? "x" : "z"]() {} y = 2; }
console.log(50, "method", keys(new M50()), keys(M50.prototype));
class G50 extends Above { get [!E.A ? "x" : "z"]() { return 1; } y = 2; }
console.log(50, "getter", keys(new G50()), keys(G50.prototype));
class A50 extends Above { accessor [!E.A ? "x" : "z"] = 1; y = 2; }
console.log(50, "accessor", keys(new A50()), keys(A50.prototype));
console.log(50, "literal", keys({ [!E.A ? "x" : "z"]: 1, y: 2 }), "pattern", (({ [!E.A ? "x" : "z"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A ? "x" : "z")); } catch {}
class F51 extends Above { [E.A ? "x" : "z"] = 1; y = 2; }
console.log(51, 'E.A ? "x" : "z"', "field", keys(new F51()));
class S51 extends Above { static [E.A ? "x" : "z"] = 1; y = 2; }
console.log(51, "static", keys(new S51()), keys(S51));
class M51 extends Above { [E.A ? "x" : "z"]() {} y = 2; }
console.log(51, "method", keys(new M51()), keys(M51.prototype));
class G51 extends Above { get [E.A ? "x" : "z"]() { return 1; } y = 2; }
console.log(51, "getter", keys(new G51()), keys(G51.prototype));
class A51 extends Above { accessor [E.A ? "x" : "z"] = 1; y = 2; }
console.log(51, "accessor", keys(new A51()), keys(A51.prototype));
console.log(51, "literal", keys({ [E.A ? "x" : "z"]: 1, y: 2 }), "pattern", (({ [E.A ? "x" : "z"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A === 21 ? "x" : "z")); } catch {}
class F52 extends Above { [E.A === 21 ? "x" : "z"] = 1; y = 2; }
console.log(52, 'E.A === 21 ? "x" : "z"', "field", keys(new F52()));
class S52 extends Above { static [E.A === 21 ? "x" : "z"] = 1; y = 2; }
console.log(52, "static", keys(new S52()), keys(S52));
class M52 extends Above { [E.A === 21 ? "x" : "z"]() {} y = 2; }
console.log(52, "method", keys(new M52()), keys(M52.prototype));
class G52 extends Above { get [E.A === 21 ? "x" : "z"]() { return 1; } y = 2; }
console.log(52, "getter", keys(new G52()), keys(G52.prototype));
class A52 extends Above { accessor [E.A === 21 ? "x" : "z"] = 1; y = 2; }
console.log(52, "accessor", keys(new A52()), keys(A52.prototype));
console.log(52, "literal", keys({ [E.A === 21 ? "x" : "z"]: 1, y: 2 }), "pattern", (({ [E.A === 21 ? "x" : "z"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A > 1 ? "x" : "z")); } catch {}
class F53 extends Above { [E.A > 1 ? "x" : "z"] = 1; y = 2; }
console.log(53, 'E.A > 1 ? "x" : "z"', "field", keys(new F53()));
class S53 extends Above { static [E.A > 1 ? "x" : "z"] = 1; y = 2; }
console.log(53, "static", keys(new S53()), keys(S53));
class M53 extends Above { [E.A > 1 ? "x" : "z"]() {} y = 2; }
console.log(53, "method", keys(new M53()), keys(M53.prototype));
class G53 extends Above { get [E.A > 1 ? "x" : "z"]() { return 1; } y = 2; }
console.log(53, "getter", keys(new G53()), keys(G53.prototype));
class A53 extends Above { accessor [E.A > 1 ? "x" : "z"] = 1; y = 2; }
console.log(53, "accessor", keys(new A53()), keys(A53.prototype));
console.log(53, "literal", keys({ [E.A > 1 ? "x" : "z"]: 1, y: 2 }), "pattern", (({ [E.A > 1 ? "x" : "z"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.Z ? "x" : "z")); } catch {}
class F54 extends Above { [E.Z ? "x" : "z"] = 1; y = 2; }
console.log(54, 'E.Z ? "x" : "z"', "field", keys(new F54()));
class S54 extends Above { static [E.Z ? "x" : "z"] = 1; y = 2; }
console.log(54, "static", keys(new S54()), keys(S54));
class M54 extends Above { [E.Z ? "x" : "z"]() {} y = 2; }
console.log(54, "method", keys(new M54()), keys(M54.prototype));
class G54 extends Above { get [E.Z ? "x" : "z"]() { return 1; } y = 2; }
console.log(54, "getter", keys(new G54()), keys(G54.prototype));
class A54 extends Above { accessor [E.Z ? "x" : "z"] = 1; y = 2; }
console.log(54, "accessor", keys(new A54()), keys(A54.prototype));
console.log(54, "literal", keys({ [E.Z ? "x" : "z"]: 1, y: 2 }), "pattern", (({ [E.Z ? "x" : "z"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.Z || "x")); } catch {}
class F55 extends Above { [E.Z || "x"] = 1; y = 2; }
console.log(55, 'E.Z || "x"', "field", keys(new F55()));
class S55 extends Above { static [E.Z || "x"] = 1; y = 2; }
console.log(55, "static", keys(new S55()), keys(S55));
class M55 extends Above { [E.Z || "x"]() {} y = 2; }
console.log(55, "method", keys(new M55()), keys(M55.prototype));
class G55 extends Above { get [E.Z || "x"]() { return 1; } y = 2; }
console.log(55, "getter", keys(new G55()), keys(G55.prototype));
class A55 extends Above { accessor [E.Z || "x"] = 1; y = 2; }
console.log(55, "accessor", keys(new A55()), keys(A55.prototype));
console.log(55, "literal", keys({ [E.Z || "x"]: 1, y: 2 }), "pattern", (({ [E.Z || "x"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.A && "x")); } catch {}
class F56 extends Above { [E.A && "x"] = 1; y = 2; }
console.log(56, 'E.A && "x"', "field", keys(new F56()));
class S56 extends Above { static [E.A && "x"] = 1; y = 2; }
console.log(56, "static", keys(new S56()), keys(S56));
class M56 extends Above { [E.A && "x"]() {} y = 2; }
console.log(56, "method", keys(new M56()), keys(M56.prototype));
class G56 extends Above { get [E.A && "x"]() { return 1; } y = 2; }
console.log(56, "getter", keys(new G56()), keys(G56.prototype));
class A56 extends Above { accessor [E.A && "x"] = 1; y = 2; }
console.log(56, "accessor", keys(new A56()), keys(A56.prototype));
console.log(56, "literal", keys({ [E.A && "x"]: 1, y: 2 }), "pattern", (({ [E.A && "x"]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? (0 || E.A) : 0)); } catch {}
class F57 extends Above { [true ? (0 || E.A) : 0] = 1; y = 2; }
console.log(57, 'true ? (0 || E.A) : 0', "field", keys(new F57()));
class S57 extends Above { static [true ? (0 || E.A) : 0] = 1; y = 2; }
console.log(57, "static", keys(new S57()), keys(S57));
class M57 extends Above { [true ? (0 || E.A) : 0]() {} y = 2; }
console.log(57, "method", keys(new M57()), keys(M57.prototype));
class G57 extends Above { get [true ? (0 || E.A) : 0]() { return 1; } y = 2; }
console.log(57, "getter", keys(new G57()), keys(G57.prototype));
class A57 extends Above { accessor [true ? (0 || E.A) : 0] = 1; y = 2; }
console.log(57, "accessor", keys(new A57()), keys(A57.prototype));
console.log(57, "literal", keys({ [true ? (0 || E.A) : 0]: 1, y: 2 }), "pattern", (({ [true ? (0 || E.A) : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? -E.A : 0)); } catch {}
class F58 extends Above { [true ? -E.A : 0] = 1; y = 2; }
console.log(58, 'true ? -E.A : 0', "field", keys(new F58()));
class S58 extends Above { static [true ? -E.A : 0] = 1; y = 2; }
console.log(58, "static", keys(new S58()), keys(S58));
class M58 extends Above { [true ? -E.A : 0]() {} y = 2; }
console.log(58, "method", keys(new M58()), keys(M58.prototype));
class G58 extends Above { get [true ? -E.A : 0]() { return 1; } y = 2; }
console.log(58, "getter", keys(new G58()), keys(G58.prototype));
class A58 extends Above { accessor [true ? -E.A : 0] = 1; y = 2; }
console.log(58, "accessor", keys(new A58()), keys(A58.prototype));
console.log(58, "literal", keys({ [true ? -E.A : 0]: 1, y: 2 }), "pattern", (({ [true ? -E.A : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(0 || -E.A)); } catch {}
class F59 extends Above { [0 || -E.A] = 1; y = 2; }
console.log(59, '0 || -E.A', "field", keys(new F59()));
class S59 extends Above { static [0 || -E.A] = 1; y = 2; }
console.log(59, "static", keys(new S59()), keys(S59));
class M59 extends Above { [0 || -E.A]() {} y = 2; }
console.log(59, "method", keys(new M59()), keys(M59.prototype));
class G59 extends Above { get [0 || -E.A]() { return 1; } y = 2; }
console.log(59, "getter", keys(new G59()), keys(G59.prototype));
class A59 extends Above { accessor [0 || -E.A] = 1; y = 2; }
console.log(59, "accessor", keys(new A59()), keys(A59.prototype));
console.log(59, "literal", keys({ [0 || -E.A]: 1, y: 2 }), "pattern", (({ [0 || -E.A]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(alias)); } catch {}
class F60 extends Above { [alias] = 1; y = 2; }
console.log(60, 'alias', "field", keys(new F60()));
class S60 extends Above { static [alias] = 1; y = 2; }
console.log(60, "static", keys(new S60()), keys(S60));
class M60 extends Above { [alias]() {} y = 2; }
console.log(60, "method", keys(new M60()), keys(M60.prototype));
class G60 extends Above { get [alias]() { return 1; } y = 2; }
console.log(60, "getter", keys(new G60()), keys(G60.prototype));
class A60 extends Above { accessor [alias] = 1; y = 2; }
console.log(60, "accessor", keys(new A60()), keys(A60.prototype));
console.log(60, "literal", keys({ [alias]: 1, y: 2 }), "pattern", (({ [alias]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? alias : 0)); } catch {}
class F61 extends Above { [true ? alias : 0] = 1; y = 2; }
console.log(61, 'true ? alias : 0', "field", keys(new F61()));
class S61 extends Above { static [true ? alias : 0] = 1; y = 2; }
console.log(61, "static", keys(new S61()), keys(S61));
class M61 extends Above { [true ? alias : 0]() {} y = 2; }
console.log(61, "method", keys(new M61()), keys(M61.prototype));
class G61 extends Above { get [true ? alias : 0]() { return 1; } y = 2; }
console.log(61, "getter", keys(new G61()), keys(G61.prototype));
class A61 extends Above { accessor [true ? alias : 0] = 1; y = 2; }
console.log(61, "accessor", keys(new A61()), keys(A61.prototype));
console.log(61, "literal", keys({ [true ? alias : 0]: 1, y: 2 }), "pattern", (({ [true ? alias : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.Computed)); } catch {}
class F62 extends Above { [E.Computed] = 1; y = 2; }
console.log(62, 'E.Computed', "field", keys(new F62()));
class S62 extends Above { static [E.Computed] = 1; y = 2; }
console.log(62, "static", keys(new S62()), keys(S62));
class M62 extends Above { [E.Computed]() {} y = 2; }
console.log(62, "method", keys(new M62()), keys(M62.prototype));
class G62 extends Above { get [E.Computed]() { return 1; } y = 2; }
console.log(62, "getter", keys(new G62()), keys(G62.prototype));
class A62 extends Above { accessor [E.Computed] = 1; y = 2; }
console.log(62, "accessor", keys(new A62()), keys(A62.prototype));
console.log(62, "literal", keys({ [E.Computed]: 1, y: 2 }), "pattern", (({ [E.Computed]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? E.Computed : 0)); } catch {}
class F63 extends Above { [true ? E.Computed : 0] = 1; y = 2; }
console.log(63, 'true ? E.Computed : 0', "field", keys(new F63()));
class S63 extends Above { static [true ? E.Computed : 0] = 1; y = 2; }
console.log(63, "static", keys(new S63()), keys(S63));
class M63 extends Above { [true ? E.Computed : 0]() {} y = 2; }
console.log(63, "method", keys(new M63()), keys(M63.prototype));
class G63 extends Above { get [true ? E.Computed : 0]() { return 1; } y = 2; }
console.log(63, "getter", keys(new G63()), keys(G63.prototype));
class A63 extends Above { accessor [true ? E.Computed : 0] = 1; y = 2; }
console.log(63, "accessor", keys(new A63()), keys(A63.prototype));
console.log(63, "literal", keys({ [true ? E.Computed : 0]: 1, y: 2 }), "pattern", (({ [true ? E.Computed : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(E.Later)); } catch {}
class F64 extends Above { [E.Later] = 1; y = 2; }
console.log(64, 'E.Later', "field", keys(new F64()));
class S64 extends Above { static [E.Later] = 1; y = 2; }
console.log(64, "static", keys(new S64()), keys(S64));
class M64 extends Above { [E.Later]() {} y = 2; }
console.log(64, "method", keys(new M64()), keys(M64.prototype));
class G64 extends Above { get [E.Later]() { return 1; } y = 2; }
console.log(64, "getter", keys(new G64()), keys(G64.prototype));
class A64 extends Above { accessor [E.Later] = 1; y = 2; }
console.log(64, "accessor", keys(new A64()), keys(A64.prototype));
console.log(64, "literal", keys({ [E.Later]: 1, y: 2 }), "pattern", (({ [E.Later]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
try { watch(String(true ? E.Later : 0)); } catch {}
class F65 extends Above { [true ? E.Later : 0] = 1; y = 2; }
console.log(65, 'true ? E.Later : 0', "field", keys(new F65()));
class S65 extends Above { static [true ? E.Later : 0] = 1; y = 2; }
console.log(65, "static", keys(new S65()), keys(S65));
class M65 extends Above { [true ? E.Later : 0]() {} y = 2; }
console.log(65, "method", keys(new M65()), keys(M65.prototype));
class G65 extends Above { get [true ? E.Later : 0]() { return 1; } y = 2; }
console.log(65, "getter", keys(new G65()), keys(G65.prototype));
class A65 extends Above { accessor [true ? E.Later : 0] = 1; y = 2; }
console.log(65, "accessor", keys(new A65()), keys(A65.prototype));
console.log(65, "literal", keys({ [true ? E.Later : 0]: 1, y: 2 }), "pattern", (({ [true ? E.Later : 0]: got }) => got)({ 21: "n21", 22: "n22", 23: "n23", 24: "n24", text: "t", x: "x", z: "z", "-21": "m21", number: "num", 2: "two", 0: "zero", t: "tt", 4: "four" }));
export {};
