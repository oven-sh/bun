// Each function of Math and each operator on numbers in a counted loop, over operands that fold to a fraction, that lie in a range, or of which nothing is known. What it gives comes round the loop.
// Written by ../../tools/generate-built-ins-in-loops.py.
function show(v: any): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n";
  if (v === undefined || v === null || typeof v !== "object") return typeof v + ":" + String(v);
  if (v instanceof Map) return "Map" + show([...v]);
  if (v instanceof Set) return "Set" + show([...v]);
  if (v instanceof RegExp) return String(v);
  if (ArrayBuffer.isView(v)) return "view" + show(Array.from(v as any));
  if (Array.isArray(v)) return "[" + v.map(show).join(",") + "]";
  if (v instanceof Number) return "Number(" + show(v.valueOf()) + ")";
  return "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join(",") + "}";
}
function p(n: number, x: any, y: any, z: any) { console.log(n, show(x), show(y), show(z)); }

function k1(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d / 3); } return b; }
p(1, k1(1.5), k1(0), k1(2));
function k2(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d / 3); } return b; }
p(2, k2(1.5), k2(0), k2(2));
function k3(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(e / 3); } return b; }
p(3, k3(1.5), k3(0), k3(2));
function k4(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(e / 3); } return b; }
p(4, k4(1.5), k4(0), k4(2));
function k5(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d); } return b; }
p(5, k5(1.5), k5(0), k5(2));
function k6(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d); } return b; }
p(6, k6(1.5), k6(0), k6(2));
function k7(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(e); } return b; }
p(7, k7(1.5), k7(0), k7(2));
function k8(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(e); } return b; }
p(8, k8(1.5), k8(0), k8(2));
function k9(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(i); } return b; }
p(9, k9(1.5), k9(0), k9(2));
function k10(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(i); } return b; }
p(10, k10(1.5), k10(0), k10(2));
function k11(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(i / 2); } return b; }
p(11, k11(1.5), k11(0), k11(2));
function k12(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(i / 2); } return b; }
p(12, k12(1.5), k12(0), k12(2));
function k13(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-i / 2); } return b; }
p(13, k13(1.5), k13(0), k13(2));
function k14(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-i / 2); } return b; }
p(14, k14(1.5), k14(0), k14(2));
function k15(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(b); } return b; }
p(15, k15(1.5), k15(0), k15(2));
function k16(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(b); } return b; }
p(16, k16(1.5), k16(0), k16(2));
function k17(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(y); } return b; }
p(17, k17(1.5), k17(0), k17(2));
function k18(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(y); } return b; }
p(18, k18(1.5), k18(0), k18(2));
function k19(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(y / 2); } return b; }
p(19, k19(1.5), k19(0), k19(2));
function k20(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(y / 2); } return b; }
p(20, k20(1.5), k20(0), k20(2));
function k21(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(0.5); } return b; }
p(21, k21(1.5), k21(0), k21(2));
function k22(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(0.5); } return b; }
p(22, k22(1.5), k22(0), k22(2));
function k23(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-0.5); } return b; }
p(23, k23(1.5), k23(0), k23(2));
function k24(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-0.5); } return b; }
p(24, k24(1.5), k24(0), k24(2));
function k25(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d * 0.5); } return b; }
p(25, k25(1.5), k25(0), k25(2));
function k26(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d * 0.5); } return b; }
p(26, k26(1.5), k26(0), k26(2));
function k27(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(NaN); } return b; }
p(27, k27(1.5), k27(0), k27(2));
function k28(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(NaN); } return b; }
p(28, k28(1.5), k28(0), k28(2));
function k29(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(1e300); } return b; }
p(29, k29(1.5), k29(0), k29(2));
function k30(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(1e300); } return b; }
p(30, k30(1.5), k30(0), k30(2));
function k31(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-0); } return b; }
p(31, k31(1.5), k31(0), k31(2));
function k32(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-0); } return b; }
p(32, k32(1.5), k32(0), k32(2));
function k33(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d % 3); } return b; }
p(33, k33(1.5), k33(0), k33(2));
function k34(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d % 3); } return b; }
p(34, k34(1.5), k34(0), k34(2));
function k35(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(i - 2); } return b; }
p(35, k35(1.5), k35(0), k35(2));
function k36(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(i - 2); } return b; }
p(36, k36(1.5), k36(0), k36(2));
function k37(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d / 3 + i); } return b; }
p(37, k37(1.5), k37(0), k37(2));
function k38(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(d / 3 + i); } return b; }
p(38, k38(1.5), k38(0), k38(2));
function k39(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs((d / 3) | 0); } return b; }
p(39, k39(1.5), k39(0), k39(2));
function k40(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs((d / 3) | 0); } return b; }
p(40, k40(1.5), k40(0), k40(2));
function k41(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(2.5 - d / 2); } return b; }
p(41, k41(1.5), k41(0), k41(2));
function k42(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(2.5 - d / 2); } return b; }
p(42, k42(1.5), k42(0), k42(2));
function k43(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(Infinity); } return b; }
p(43, k43(1.5), k43(0), k43(2));
function k44(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(Infinity); } return b; }
p(44, k44(1.5), k44(0), k44(2));
function k45(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-d / 7); } return b; }
p(45, k45(1.5), k45(0), k45(2));
function k46(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.abs(-d / 7); } return b; }
p(46, k46(1.5), k46(0), k46(2));
function k47(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(d / 3); } return b; }
p(47, k47(1.5), k47(0), k47(2));
function k48(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(e / 3); } return b; }
p(48, k48(1.5), k48(0), k48(2));
function k49(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(d); } return b; }
p(49, k49(1.5), k49(0), k49(2));
function k50(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(e); } return b; }
p(50, k50(1.5), k50(0), k50(2));
function k51(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(i); } return b; }
p(51, k51(1.5), k51(0), k51(2));
function k52(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(i / 2); } return b; }
p(52, k52(1.5), k52(0), k52(2));
function k53(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(-i / 2); } return b; }
p(53, k53(1.5), k53(0), k53(2));
function k54(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(b); } return b; }
p(54, k54(1.5), k54(0), k54(2));
function k55(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(y); } return b; }
p(55, k55(1.5), k55(0), k55(2));
function k56(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(y / 2); } return b; }
p(56, k56(1.5), k56(0), k56(2));
function k57(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(0.5); } return b; }
p(57, k57(1.5), k57(0), k57(2));
function k58(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(-0.5); } return b; }
p(58, k58(1.5), k58(0), k58(2));
function k59(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(d * 0.5); } return b; }
p(59, k59(1.5), k59(0), k59(2));
function k60(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(NaN); } return b; }
p(60, k60(1.5), k60(0), k60(2));
function k61(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(1e300); } return b; }
p(61, k61(1.5), k61(0), k61(2));
function k62(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(-0); } return b; }
p(62, k62(1.5), k62(0), k62(2));
function k63(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(d % 3); } return b; }
p(63, k63(1.5), k63(0), k63(2));
function k64(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(i - 2); } return b; }
p(64, k64(1.5), k64(0), k64(2));
function k65(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(d / 3 + i); } return b; }
p(65, k65(1.5), k65(0), k65(2));
function k66(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos((d / 3) | 0); } return b; }
p(66, k66(1.5), k66(0), k66(2));
function k67(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(2.5 - d / 2); } return b; }
p(67, k67(1.5), k67(0), k67(2));
function k68(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(Infinity); } return b; }
p(68, k68(1.5), k68(0), k68(2));
function k69(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acos(-d / 7); } return b; }
p(69, k69(1.5), k69(0), k69(2));
function k70(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(d / 3); } return b; }
p(70, k70(1.5), k70(0), k70(2));
function k71(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(e / 3); } return b; }
p(71, k71(1.5), k71(0), k71(2));
function k72(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(d); } return b; }
p(72, k72(1.5), k72(0), k72(2));
function k73(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(e); } return b; }
p(73, k73(1.5), k73(0), k73(2));
function k74(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(i); } return b; }
p(74, k74(1.5), k74(0), k74(2));
function k75(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(i / 2); } return b; }
p(75, k75(1.5), k75(0), k75(2));
function k76(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(-i / 2); } return b; }
p(76, k76(1.5), k76(0), k76(2));
function k77(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(b); } return b; }
p(77, k77(1.5), k77(0), k77(2));
function k78(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(y); } return b; }
p(78, k78(1.5), k78(0), k78(2));
function k79(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(y / 2); } return b; }
p(79, k79(1.5), k79(0), k79(2));
function k80(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(0.5); } return b; }
p(80, k80(1.5), k80(0), k80(2));
function k81(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(-0.5); } return b; }
p(81, k81(1.5), k81(0), k81(2));
function k82(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(d * 0.5); } return b; }
p(82, k82(1.5), k82(0), k82(2));
function k83(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(NaN); } return b; }
p(83, k83(1.5), k83(0), k83(2));
function k84(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(1e300); } return b; }
p(84, k84(1.5), k84(0), k84(2));
function k85(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(-0); } return b; }
p(85, k85(1.5), k85(0), k85(2));
function k86(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(d % 3); } return b; }
p(86, k86(1.5), k86(0), k86(2));
function k87(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(i - 2); } return b; }
p(87, k87(1.5), k87(0), k87(2));
function k88(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(d / 3 + i); } return b; }
p(88, k88(1.5), k88(0), k88(2));
function k89(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh((d / 3) | 0); } return b; }
p(89, k89(1.5), k89(0), k89(2));
function k90(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(2.5 - d / 2); } return b; }
p(90, k90(1.5), k90(0), k90(2));
function k91(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(Infinity); } return b; }
p(91, k91(1.5), k91(0), k91(2));
function k92(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.acosh(-d / 7); } return b; }
p(92, k92(1.5), k92(0), k92(2));
function k93(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(d / 3); } return b; }
p(93, k93(1.5), k93(0), k93(2));
function k94(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(e / 3); } return b; }
p(94, k94(1.5), k94(0), k94(2));
function k95(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(d); } return b; }
p(95, k95(1.5), k95(0), k95(2));
function k96(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(e); } return b; }
p(96, k96(1.5), k96(0), k96(2));
function k97(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(i); } return b; }
p(97, k97(1.5), k97(0), k97(2));
function k98(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(i / 2); } return b; }
p(98, k98(1.5), k98(0), k98(2));
function k99(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(-i / 2); } return b; }
p(99, k99(1.5), k99(0), k99(2));
function k100(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(b); } return b; }
p(100, k100(1.5), k100(0), k100(2));
function k101(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(y); } return b; }
p(101, k101(1.5), k101(0), k101(2));
function k102(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(y / 2); } return b; }
p(102, k102(1.5), k102(0), k102(2));
function k103(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(0.5); } return b; }
p(103, k103(1.5), k103(0), k103(2));
function k104(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(-0.5); } return b; }
p(104, k104(1.5), k104(0), k104(2));
function k105(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(d * 0.5); } return b; }
p(105, k105(1.5), k105(0), k105(2));
function k106(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(NaN); } return b; }
p(106, k106(1.5), k106(0), k106(2));
function k107(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(1e300); } return b; }
p(107, k107(1.5), k107(0), k107(2));
function k108(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(-0); } return b; }
p(108, k108(1.5), k108(0), k108(2));
function k109(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(d % 3); } return b; }
p(109, k109(1.5), k109(0), k109(2));
function k110(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(i - 2); } return b; }
p(110, k110(1.5), k110(0), k110(2));
function k111(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(d / 3 + i); } return b; }
p(111, k111(1.5), k111(0), k111(2));
function k112(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin((d / 3) | 0); } return b; }
p(112, k112(1.5), k112(0), k112(2));
function k113(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(2.5 - d / 2); } return b; }
p(113, k113(1.5), k113(0), k113(2));
function k114(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(Infinity); } return b; }
p(114, k114(1.5), k114(0), k114(2));
function k115(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asin(-d / 7); } return b; }
p(115, k115(1.5), k115(0), k115(2));
function k116(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(d / 3); } return b; }
p(116, k116(1.5), k116(0), k116(2));
function k117(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(e / 3); } return b; }
p(117, k117(1.5), k117(0), k117(2));
function k118(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(d); } return b; }
p(118, k118(1.5), k118(0), k118(2));
function k119(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(e); } return b; }
p(119, k119(1.5), k119(0), k119(2));
function k120(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(i); } return b; }
p(120, k120(1.5), k120(0), k120(2));
function k121(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(i / 2); } return b; }
p(121, k121(1.5), k121(0), k121(2));
function k122(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(-i / 2); } return b; }
p(122, k122(1.5), k122(0), k122(2));
function k123(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(b); } return b; }
p(123, k123(1.5), k123(0), k123(2));
function k124(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(y); } return b; }
p(124, k124(1.5), k124(0), k124(2));
function k125(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(y / 2); } return b; }
p(125, k125(1.5), k125(0), k125(2));
function k126(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(0.5); } return b; }
p(126, k126(1.5), k126(0), k126(2));
function k127(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(-0.5); } return b; }
p(127, k127(1.5), k127(0), k127(2));
function k128(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(d * 0.5); } return b; }
p(128, k128(1.5), k128(0), k128(2));
function k129(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(NaN); } return b; }
p(129, k129(1.5), k129(0), k129(2));
function k130(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(1e300); } return b; }
p(130, k130(1.5), k130(0), k130(2));
function k131(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(-0); } return b; }
p(131, k131(1.5), k131(0), k131(2));
function k132(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(d % 3); } return b; }
p(132, k132(1.5), k132(0), k132(2));
function k133(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(i - 2); } return b; }
p(133, k133(1.5), k133(0), k133(2));
function k134(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(d / 3 + i); } return b; }
p(134, k134(1.5), k134(0), k134(2));
function k135(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh((d / 3) | 0); } return b; }
p(135, k135(1.5), k135(0), k135(2));
function k136(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(2.5 - d / 2); } return b; }
p(136, k136(1.5), k136(0), k136(2));
function k137(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(Infinity); } return b; }
p(137, k137(1.5), k137(0), k137(2));
function k138(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.asinh(-d / 7); } return b; }
p(138, k138(1.5), k138(0), k138(2));
function k139(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(d / 3); } return b; }
p(139, k139(1.5), k139(0), k139(2));
function k140(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(e / 3); } return b; }
p(140, k140(1.5), k140(0), k140(2));
function k141(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(d); } return b; }
p(141, k141(1.5), k141(0), k141(2));
function k142(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(e); } return b; }
p(142, k142(1.5), k142(0), k142(2));
function k143(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(i); } return b; }
p(143, k143(1.5), k143(0), k143(2));
function k144(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(i / 2); } return b; }
p(144, k144(1.5), k144(0), k144(2));
function k145(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(-i / 2); } return b; }
p(145, k145(1.5), k145(0), k145(2));
function k146(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(b); } return b; }
p(146, k146(1.5), k146(0), k146(2));
function k147(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(y); } return b; }
p(147, k147(1.5), k147(0), k147(2));
function k148(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(y / 2); } return b; }
p(148, k148(1.5), k148(0), k148(2));
function k149(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(0.5); } return b; }
p(149, k149(1.5), k149(0), k149(2));
function k150(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(-0.5); } return b; }
p(150, k150(1.5), k150(0), k150(2));
function k151(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(d * 0.5); } return b; }
p(151, k151(1.5), k151(0), k151(2));
function k152(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(NaN); } return b; }
p(152, k152(1.5), k152(0), k152(2));
function k153(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(1e300); } return b; }
p(153, k153(1.5), k153(0), k153(2));
function k154(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(-0); } return b; }
p(154, k154(1.5), k154(0), k154(2));
function k155(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(d % 3); } return b; }
p(155, k155(1.5), k155(0), k155(2));
function k156(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(i - 2); } return b; }
p(156, k156(1.5), k156(0), k156(2));
function k157(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(d / 3 + i); } return b; }
p(157, k157(1.5), k157(0), k157(2));
function k158(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan((d / 3) | 0); } return b; }
p(158, k158(1.5), k158(0), k158(2));
function k159(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(2.5 - d / 2); } return b; }
p(159, k159(1.5), k159(0), k159(2));
function k160(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(Infinity); } return b; }
p(160, k160(1.5), k160(0), k160(2));
function k161(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan(-d / 7); } return b; }
p(161, k161(1.5), k161(0), k161(2));
function k162(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(d / 3); } return b; }
p(162, k162(1.5), k162(0), k162(2));
function k163(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(e / 3); } return b; }
p(163, k163(1.5), k163(0), k163(2));
function k164(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(d); } return b; }
p(164, k164(1.5), k164(0), k164(2));
function k165(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(e); } return b; }
p(165, k165(1.5), k165(0), k165(2));
function k166(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(i); } return b; }
p(166, k166(1.5), k166(0), k166(2));
function k167(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(i / 2); } return b; }
p(167, k167(1.5), k167(0), k167(2));
function k168(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(-i / 2); } return b; }
p(168, k168(1.5), k168(0), k168(2));
function k169(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(b); } return b; }
p(169, k169(1.5), k169(0), k169(2));
function k170(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(y); } return b; }
p(170, k170(1.5), k170(0), k170(2));
function k171(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(y / 2); } return b; }
p(171, k171(1.5), k171(0), k171(2));
function k172(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(0.5); } return b; }
p(172, k172(1.5), k172(0), k172(2));
function k173(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(-0.5); } return b; }
p(173, k173(1.5), k173(0), k173(2));
function k174(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(d * 0.5); } return b; }
p(174, k174(1.5), k174(0), k174(2));
function k175(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(NaN); } return b; }
p(175, k175(1.5), k175(0), k175(2));
function k176(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(1e300); } return b; }
p(176, k176(1.5), k176(0), k176(2));
function k177(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(-0); } return b; }
p(177, k177(1.5), k177(0), k177(2));
function k178(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(d % 3); } return b; }
p(178, k178(1.5), k178(0), k178(2));
function k179(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(i - 2); } return b; }
p(179, k179(1.5), k179(0), k179(2));
function k180(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(d / 3 + i); } return b; }
p(180, k180(1.5), k180(0), k180(2));
function k181(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh((d / 3) | 0); } return b; }
p(181, k181(1.5), k181(0), k181(2));
function k182(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(2.5 - d / 2); } return b; }
p(182, k182(1.5), k182(0), k182(2));
function k183(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(Infinity); } return b; }
p(183, k183(1.5), k183(0), k183(2));
function k184(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atanh(-d / 7); } return b; }
p(184, k184(1.5), k184(0), k184(2));
function k185(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(d / 3); } return b; }
p(185, k185(1.5), k185(0), k185(2));
function k186(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(e / 3); } return b; }
p(186, k186(1.5), k186(0), k186(2));
function k187(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(d); } return b; }
p(187, k187(1.5), k187(0), k187(2));
function k188(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(e); } return b; }
p(188, k188(1.5), k188(0), k188(2));
function k189(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(i); } return b; }
p(189, k189(1.5), k189(0), k189(2));
function k190(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(i / 2); } return b; }
p(190, k190(1.5), k190(0), k190(2));
function k191(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(-i / 2); } return b; }
p(191, k191(1.5), k191(0), k191(2));
function k192(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(b); } return b; }
p(192, k192(1.5), k192(0), k192(2));
function k193(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(y); } return b; }
p(193, k193(1.5), k193(0), k193(2));
function k194(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(y / 2); } return b; }
p(194, k194(1.5), k194(0), k194(2));
function k195(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(0.5); } return b; }
p(195, k195(1.5), k195(0), k195(2));
function k196(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(-0.5); } return b; }
p(196, k196(1.5), k196(0), k196(2));
function k197(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(d * 0.5); } return b; }
p(197, k197(1.5), k197(0), k197(2));
function k198(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(NaN); } return b; }
p(198, k198(1.5), k198(0), k198(2));
function k199(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(1e300); } return b; }
p(199, k199(1.5), k199(0), k199(2));
function k200(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(-0); } return b; }
p(200, k200(1.5), k200(0), k200(2));
function k201(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(d % 3); } return b; }
p(201, k201(1.5), k201(0), k201(2));
function k202(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(i - 2); } return b; }
p(202, k202(1.5), k202(0), k202(2));
function k203(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(d / 3 + i); } return b; }
p(203, k203(1.5), k203(0), k203(2));
function k204(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt((d / 3) | 0); } return b; }
p(204, k204(1.5), k204(0), k204(2));
function k205(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(2.5 - d / 2); } return b; }
p(205, k205(1.5), k205(0), k205(2));
function k206(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(Infinity); } return b; }
p(206, k206(1.5), k206(0), k206(2));
function k207(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cbrt(-d / 7); } return b; }
p(207, k207(1.5), k207(0), k207(2));
function k208(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d / 3); } return b; }
p(208, k208(1.5), k208(0), k208(2));
function k209(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d / 3); } return b; }
p(209, k209(1.5), k209(0), k209(2));
function k210(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(e / 3); } return b; }
p(210, k210(1.5), k210(0), k210(2));
function k211(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(e / 3); } return b; }
p(211, k211(1.5), k211(0), k211(2));
function k212(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d); } return b; }
p(212, k212(1.5), k212(0), k212(2));
function k213(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d); } return b; }
p(213, k213(1.5), k213(0), k213(2));
function k214(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(e); } return b; }
p(214, k214(1.5), k214(0), k214(2));
function k215(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(e); } return b; }
p(215, k215(1.5), k215(0), k215(2));
function k216(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(i); } return b; }
p(216, k216(1.5), k216(0), k216(2));
function k217(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(i); } return b; }
p(217, k217(1.5), k217(0), k217(2));
function k218(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(i / 2); } return b; }
p(218, k218(1.5), k218(0), k218(2));
function k219(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(i / 2); } return b; }
p(219, k219(1.5), k219(0), k219(2));
function k220(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-i / 2); } return b; }
p(220, k220(1.5), k220(0), k220(2));
function k221(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-i / 2); } return b; }
p(221, k221(1.5), k221(0), k221(2));
function k222(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(b); } return b; }
p(222, k222(1.5), k222(0), k222(2));
function k223(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(b); } return b; }
p(223, k223(1.5), k223(0), k223(2));
function k224(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(y); } return b; }
p(224, k224(1.5), k224(0), k224(2));
function k225(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(y); } return b; }
p(225, k225(1.5), k225(0), k225(2));
function k226(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(y / 2); } return b; }
p(226, k226(1.5), k226(0), k226(2));
function k227(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(y / 2); } return b; }
p(227, k227(1.5), k227(0), k227(2));
function k228(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(0.5); } return b; }
p(228, k228(1.5), k228(0), k228(2));
function k229(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(0.5); } return b; }
p(229, k229(1.5), k229(0), k229(2));
function k230(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-0.5); } return b; }
p(230, k230(1.5), k230(0), k230(2));
function k231(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-0.5); } return b; }
p(231, k231(1.5), k231(0), k231(2));
function k232(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d * 0.5); } return b; }
p(232, k232(1.5), k232(0), k232(2));
function k233(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d * 0.5); } return b; }
p(233, k233(1.5), k233(0), k233(2));
function k234(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(NaN); } return b; }
p(234, k234(1.5), k234(0), k234(2));
function k235(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(NaN); } return b; }
p(235, k235(1.5), k235(0), k235(2));
function k236(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(1e300); } return b; }
p(236, k236(1.5), k236(0), k236(2));
function k237(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(1e300); } return b; }
p(237, k237(1.5), k237(0), k237(2));
function k238(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-0); } return b; }
p(238, k238(1.5), k238(0), k238(2));
function k239(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-0); } return b; }
p(239, k239(1.5), k239(0), k239(2));
function k240(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d % 3); } return b; }
p(240, k240(1.5), k240(0), k240(2));
function k241(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d % 3); } return b; }
p(241, k241(1.5), k241(0), k241(2));
function k242(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(i - 2); } return b; }
p(242, k242(1.5), k242(0), k242(2));
function k243(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(i - 2); } return b; }
p(243, k243(1.5), k243(0), k243(2));
function k244(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d / 3 + i); } return b; }
p(244, k244(1.5), k244(0), k244(2));
function k245(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(d / 3 + i); } return b; }
p(245, k245(1.5), k245(0), k245(2));
function k246(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil((d / 3) | 0); } return b; }
p(246, k246(1.5), k246(0), k246(2));
function k247(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil((d / 3) | 0); } return b; }
p(247, k247(1.5), k247(0), k247(2));
function k248(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(2.5 - d / 2); } return b; }
p(248, k248(1.5), k248(0), k248(2));
function k249(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(2.5 - d / 2); } return b; }
p(249, k249(1.5), k249(0), k249(2));
function k250(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(Infinity); } return b; }
p(250, k250(1.5), k250(0), k250(2));
function k251(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(Infinity); } return b; }
p(251, k251(1.5), k251(0), k251(2));
function k252(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-d / 7); } return b; }
p(252, k252(1.5), k252(0), k252(2));
function k253(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.ceil(-d / 7); } return b; }
p(253, k253(1.5), k253(0), k253(2));
function k254(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(d / 3); } return b; }
p(254, k254(1.5), k254(0), k254(2));
function k255(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(e / 3); } return b; }
p(255, k255(1.5), k255(0), k255(2));
function k256(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(d); } return b; }
p(256, k256(1.5), k256(0), k256(2));
function k257(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(e); } return b; }
p(257, k257(1.5), k257(0), k257(2));
function k258(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(i); } return b; }
p(258, k258(1.5), k258(0), k258(2));
function k259(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(i / 2); } return b; }
p(259, k259(1.5), k259(0), k259(2));
function k260(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(-i / 2); } return b; }
p(260, k260(1.5), k260(0), k260(2));
function k261(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(b); } return b; }
p(261, k261(1.5), k261(0), k261(2));
function k262(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(y); } return b; }
p(262, k262(1.5), k262(0), k262(2));
function k263(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(y / 2); } return b; }
p(263, k263(1.5), k263(0), k263(2));
function k264(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(0.5); } return b; }
p(264, k264(1.5), k264(0), k264(2));
function k265(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(-0.5); } return b; }
p(265, k265(1.5), k265(0), k265(2));
function k266(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(d * 0.5); } return b; }
p(266, k266(1.5), k266(0), k266(2));
function k267(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(NaN); } return b; }
p(267, k267(1.5), k267(0), k267(2));
function k268(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(1e300); } return b; }
p(268, k268(1.5), k268(0), k268(2));
function k269(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(-0); } return b; }
p(269, k269(1.5), k269(0), k269(2));
function k270(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(d % 3); } return b; }
p(270, k270(1.5), k270(0), k270(2));
function k271(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(i - 2); } return b; }
p(271, k271(1.5), k271(0), k271(2));
function k272(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(d / 3 + i); } return b; }
p(272, k272(1.5), k272(0), k272(2));
function k273(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32((d / 3) | 0); } return b; }
p(273, k273(1.5), k273(0), k273(2));
function k274(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(2.5 - d / 2); } return b; }
p(274, k274(1.5), k274(0), k274(2));
function k275(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(Infinity); } return b; }
p(275, k275(1.5), k275(0), k275(2));
function k276(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.clz32(-d / 7); } return b; }
p(276, k276(1.5), k276(0), k276(2));
function k277(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(d / 3); } return b; }
p(277, k277(1.5), k277(0), k277(2));
function k278(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(e / 3); } return b; }
p(278, k278(1.5), k278(0), k278(2));
function k279(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(d); } return b; }
p(279, k279(1.5), k279(0), k279(2));
function k280(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(e); } return b; }
p(280, k280(1.5), k280(0), k280(2));
function k281(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(i); } return b; }
p(281, k281(1.5), k281(0), k281(2));
function k282(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(i / 2); } return b; }
p(282, k282(1.5), k282(0), k282(2));
function k283(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(-i / 2); } return b; }
p(283, k283(1.5), k283(0), k283(2));
function k284(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(b); } return b; }
p(284, k284(1.5), k284(0), k284(2));
function k285(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(y); } return b; }
p(285, k285(1.5), k285(0), k285(2));
function k286(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(y / 2); } return b; }
p(286, k286(1.5), k286(0), k286(2));
function k287(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(0.5); } return b; }
p(287, k287(1.5), k287(0), k287(2));
function k288(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(-0.5); } return b; }
p(288, k288(1.5), k288(0), k288(2));
function k289(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(d * 0.5); } return b; }
p(289, k289(1.5), k289(0), k289(2));
function k290(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(NaN); } return b; }
p(290, k290(1.5), k290(0), k290(2));
function k291(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(1e300); } return b; }
p(291, k291(1.5), k291(0), k291(2));
function k292(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(-0); } return b; }
p(292, k292(1.5), k292(0), k292(2));
function k293(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(d % 3); } return b; }
p(293, k293(1.5), k293(0), k293(2));
function k294(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(i - 2); } return b; }
p(294, k294(1.5), k294(0), k294(2));
function k295(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(d / 3 + i); } return b; }
p(295, k295(1.5), k295(0), k295(2));
function k296(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos((d / 3) | 0); } return b; }
p(296, k296(1.5), k296(0), k296(2));
function k297(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(2.5 - d / 2); } return b; }
p(297, k297(1.5), k297(0), k297(2));
function k298(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(Infinity); } return b; }
p(298, k298(1.5), k298(0), k298(2));
function k299(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cos(-d / 7); } return b; }
p(299, k299(1.5), k299(0), k299(2));
function k300(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(d / 3); } return b; }
p(300, k300(1.5), k300(0), k300(2));
function k301(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(e / 3); } return b; }
p(301, k301(1.5), k301(0), k301(2));
function k302(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(d); } return b; }
p(302, k302(1.5), k302(0), k302(2));
function k303(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(e); } return b; }
p(303, k303(1.5), k303(0), k303(2));
function k304(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(i); } return b; }
p(304, k304(1.5), k304(0), k304(2));
function k305(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(i / 2); } return b; }
p(305, k305(1.5), k305(0), k305(2));
function k306(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(-i / 2); } return b; }
p(306, k306(1.5), k306(0), k306(2));
function k307(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(b); } return b; }
p(307, k307(1.5), k307(0), k307(2));
function k308(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(y); } return b; }
p(308, k308(1.5), k308(0), k308(2));
function k309(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(y / 2); } return b; }
p(309, k309(1.5), k309(0), k309(2));
function k310(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(0.5); } return b; }
p(310, k310(1.5), k310(0), k310(2));
function k311(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(-0.5); } return b; }
p(311, k311(1.5), k311(0), k311(2));
function k312(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(d * 0.5); } return b; }
p(312, k312(1.5), k312(0), k312(2));
function k313(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(NaN); } return b; }
p(313, k313(1.5), k313(0), k313(2));
function k314(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(1e300); } return b; }
p(314, k314(1.5), k314(0), k314(2));
function k315(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(-0); } return b; }
p(315, k315(1.5), k315(0), k315(2));
function k316(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(d % 3); } return b; }
p(316, k316(1.5), k316(0), k316(2));
function k317(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(i - 2); } return b; }
p(317, k317(1.5), k317(0), k317(2));
function k318(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(d / 3 + i); } return b; }
p(318, k318(1.5), k318(0), k318(2));
function k319(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh((d / 3) | 0); } return b; }
p(319, k319(1.5), k319(0), k319(2));
function k320(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(2.5 - d / 2); } return b; }
p(320, k320(1.5), k320(0), k320(2));
function k321(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(Infinity); } return b; }
p(321, k321(1.5), k321(0), k321(2));
function k322(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.cosh(-d / 7); } return b; }
p(322, k322(1.5), k322(0), k322(2));
function k323(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(d / 3); } return b; }
p(323, k323(1.5), k323(0), k323(2));
function k324(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(e / 3); } return b; }
p(324, k324(1.5), k324(0), k324(2));
function k325(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(d); } return b; }
p(325, k325(1.5), k325(0), k325(2));
function k326(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(e); } return b; }
p(326, k326(1.5), k326(0), k326(2));
function k327(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(i); } return b; }
p(327, k327(1.5), k327(0), k327(2));
function k328(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(i / 2); } return b; }
p(328, k328(1.5), k328(0), k328(2));
function k329(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(-i / 2); } return b; }
p(329, k329(1.5), k329(0), k329(2));
function k330(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(b); } return b; }
p(330, k330(1.5), k330(0), k330(2));
function k331(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(y); } return b; }
p(331, k331(1.5), k331(0), k331(2));
function k332(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(y / 2); } return b; }
p(332, k332(1.5), k332(0), k332(2));
function k333(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(0.5); } return b; }
p(333, k333(1.5), k333(0), k333(2));
function k334(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(-0.5); } return b; }
p(334, k334(1.5), k334(0), k334(2));
function k335(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(d * 0.5); } return b; }
p(335, k335(1.5), k335(0), k335(2));
function k336(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(NaN); } return b; }
p(336, k336(1.5), k336(0), k336(2));
function k337(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(1e300); } return b; }
p(337, k337(1.5), k337(0), k337(2));
function k338(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(-0); } return b; }
p(338, k338(1.5), k338(0), k338(2));
function k339(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(d % 3); } return b; }
p(339, k339(1.5), k339(0), k339(2));
function k340(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(i - 2); } return b; }
p(340, k340(1.5), k340(0), k340(2));
function k341(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(d / 3 + i); } return b; }
p(341, k341(1.5), k341(0), k341(2));
function k342(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp((d / 3) | 0); } return b; }
p(342, k342(1.5), k342(0), k342(2));
function k343(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(2.5 - d / 2); } return b; }
p(343, k343(1.5), k343(0), k343(2));
function k344(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(Infinity); } return b; }
p(344, k344(1.5), k344(0), k344(2));
function k345(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.exp(-d / 7); } return b; }
p(345, k345(1.5), k345(0), k345(2));
function k346(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(d / 3); } return b; }
p(346, k346(1.5), k346(0), k346(2));
function k347(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(e / 3); } return b; }
p(347, k347(1.5), k347(0), k347(2));
function k348(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(d); } return b; }
p(348, k348(1.5), k348(0), k348(2));
function k349(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(e); } return b; }
p(349, k349(1.5), k349(0), k349(2));
function k350(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(i); } return b; }
p(350, k350(1.5), k350(0), k350(2));
function k351(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(i / 2); } return b; }
p(351, k351(1.5), k351(0), k351(2));
function k352(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(-i / 2); } return b; }
p(352, k352(1.5), k352(0), k352(2));
function k353(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(b); } return b; }
p(353, k353(1.5), k353(0), k353(2));
function k354(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(y); } return b; }
p(354, k354(1.5), k354(0), k354(2));
function k355(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(y / 2); } return b; }
p(355, k355(1.5), k355(0), k355(2));
function k356(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(0.5); } return b; }
p(356, k356(1.5), k356(0), k356(2));
function k357(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(-0.5); } return b; }
p(357, k357(1.5), k357(0), k357(2));
function k358(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(d * 0.5); } return b; }
p(358, k358(1.5), k358(0), k358(2));
function k359(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(NaN); } return b; }
p(359, k359(1.5), k359(0), k359(2));
function k360(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(1e300); } return b; }
p(360, k360(1.5), k360(0), k360(2));
function k361(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(-0); } return b; }
p(361, k361(1.5), k361(0), k361(2));
function k362(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(d % 3); } return b; }
p(362, k362(1.5), k362(0), k362(2));
function k363(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(i - 2); } return b; }
p(363, k363(1.5), k363(0), k363(2));
function k364(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(d / 3 + i); } return b; }
p(364, k364(1.5), k364(0), k364(2));
function k365(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1((d / 3) | 0); } return b; }
p(365, k365(1.5), k365(0), k365(2));
function k366(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(2.5 - d / 2); } return b; }
p(366, k366(1.5), k366(0), k366(2));
function k367(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(Infinity); } return b; }
p(367, k367(1.5), k367(0), k367(2));
function k368(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.expm1(-d / 7); } return b; }
p(368, k368(1.5), k368(0), k368(2));
function k369(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(d / 3); } return b; }
p(369, k369(1.5), k369(0), k369(2));
function k370(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(e / 3); } return b; }
p(370, k370(1.5), k370(0), k370(2));
function k371(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(d); } return b; }
p(371, k371(1.5), k371(0), k371(2));
function k372(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(e); } return b; }
p(372, k372(1.5), k372(0), k372(2));
function k373(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(i); } return b; }
p(373, k373(1.5), k373(0), k373(2));
function k374(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(i / 2); } return b; }
p(374, k374(1.5), k374(0), k374(2));
function k375(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(-i / 2); } return b; }
p(375, k375(1.5), k375(0), k375(2));
function k376(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(b); } return b; }
p(376, k376(1.5), k376(0), k376(2));
function k377(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(y); } return b; }
p(377, k377(1.5), k377(0), k377(2));
function k378(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(y / 2); } return b; }
p(378, k378(1.5), k378(0), k378(2));
function k379(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(0.5); } return b; }
p(379, k379(1.5), k379(0), k379(2));
function k380(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(-0.5); } return b; }
p(380, k380(1.5), k380(0), k380(2));
function k381(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(d * 0.5); } return b; }
p(381, k381(1.5), k381(0), k381(2));
function k382(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(NaN); } return b; }
p(382, k382(1.5), k382(0), k382(2));
function k383(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(1e300); } return b; }
p(383, k383(1.5), k383(0), k383(2));
function k384(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(-0); } return b; }
p(384, k384(1.5), k384(0), k384(2));
function k385(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(d % 3); } return b; }
p(385, k385(1.5), k385(0), k385(2));
function k386(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(i - 2); } return b; }
p(386, k386(1.5), k386(0), k386(2));
function k387(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(d / 3 + i); } return b; }
p(387, k387(1.5), k387(0), k387(2));
function k388(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round((d / 3) | 0); } return b; }
p(388, k388(1.5), k388(0), k388(2));
function k389(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(2.5 - d / 2); } return b; }
p(389, k389(1.5), k389(0), k389(2));
function k390(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(Infinity); } return b; }
p(390, k390(1.5), k390(0), k390(2));
function k391(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.f16round(-d / 7); } return b; }
p(391, k391(1.5), k391(0), k391(2));
function k392(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d / 3); } return b; }
p(392, k392(1.5), k392(0), k392(2));
function k393(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d / 3); } return b; }
p(393, k393(1.5), k393(0), k393(2));
function k394(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(e / 3); } return b; }
p(394, k394(1.5), k394(0), k394(2));
function k395(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(e / 3); } return b; }
p(395, k395(1.5), k395(0), k395(2));
function k396(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d); } return b; }
p(396, k396(1.5), k396(0), k396(2));
function k397(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d); } return b; }
p(397, k397(1.5), k397(0), k397(2));
function k398(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(e); } return b; }
p(398, k398(1.5), k398(0), k398(2));
function k399(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(e); } return b; }
p(399, k399(1.5), k399(0), k399(2));
function k400(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(i); } return b; }
p(400, k400(1.5), k400(0), k400(2));
function k401(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(i); } return b; }
p(401, k401(1.5), k401(0), k401(2));
function k402(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(i / 2); } return b; }
p(402, k402(1.5), k402(0), k402(2));
function k403(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(i / 2); } return b; }
p(403, k403(1.5), k403(0), k403(2));
function k404(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-i / 2); } return b; }
p(404, k404(1.5), k404(0), k404(2));
function k405(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-i / 2); } return b; }
p(405, k405(1.5), k405(0), k405(2));
function k406(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(b); } return b; }
p(406, k406(1.5), k406(0), k406(2));
function k407(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(b); } return b; }
p(407, k407(1.5), k407(0), k407(2));
function k408(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(y); } return b; }
p(408, k408(1.5), k408(0), k408(2));
function k409(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(y); } return b; }
p(409, k409(1.5), k409(0), k409(2));
function k410(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(y / 2); } return b; }
p(410, k410(1.5), k410(0), k410(2));
function k411(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(y / 2); } return b; }
p(411, k411(1.5), k411(0), k411(2));
function k412(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(0.5); } return b; }
p(412, k412(1.5), k412(0), k412(2));
function k413(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(0.5); } return b; }
p(413, k413(1.5), k413(0), k413(2));
function k414(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-0.5); } return b; }
p(414, k414(1.5), k414(0), k414(2));
function k415(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-0.5); } return b; }
p(415, k415(1.5), k415(0), k415(2));
function k416(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d * 0.5); } return b; }
p(416, k416(1.5), k416(0), k416(2));
function k417(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d * 0.5); } return b; }
p(417, k417(1.5), k417(0), k417(2));
function k418(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(NaN); } return b; }
p(418, k418(1.5), k418(0), k418(2));
function k419(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(NaN); } return b; }
p(419, k419(1.5), k419(0), k419(2));
function k420(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(1e300); } return b; }
p(420, k420(1.5), k420(0), k420(2));
function k421(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(1e300); } return b; }
p(421, k421(1.5), k421(0), k421(2));
function k422(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-0); } return b; }
p(422, k422(1.5), k422(0), k422(2));
function k423(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-0); } return b; }
p(423, k423(1.5), k423(0), k423(2));
function k424(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d % 3); } return b; }
p(424, k424(1.5), k424(0), k424(2));
function k425(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d % 3); } return b; }
p(425, k425(1.5), k425(0), k425(2));
function k426(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(i - 2); } return b; }
p(426, k426(1.5), k426(0), k426(2));
function k427(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(i - 2); } return b; }
p(427, k427(1.5), k427(0), k427(2));
function k428(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d / 3 + i); } return b; }
p(428, k428(1.5), k428(0), k428(2));
function k429(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(d / 3 + i); } return b; }
p(429, k429(1.5), k429(0), k429(2));
function k430(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor((d / 3) | 0); } return b; }
p(430, k430(1.5), k430(0), k430(2));
function k431(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor((d / 3) | 0); } return b; }
p(431, k431(1.5), k431(0), k431(2));
function k432(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(2.5 - d / 2); } return b; }
p(432, k432(1.5), k432(0), k432(2));
function k433(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(2.5 - d / 2); } return b; }
p(433, k433(1.5), k433(0), k433(2));
function k434(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(Infinity); } return b; }
p(434, k434(1.5), k434(0), k434(2));
function k435(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(Infinity); } return b; }
p(435, k435(1.5), k435(0), k435(2));
function k436(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-d / 7); } return b; }
p(436, k436(1.5), k436(0), k436(2));
function k437(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.floor(-d / 7); } return b; }
p(437, k437(1.5), k437(0), k437(2));
function k438(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(d / 3); } return b; }
p(438, k438(1.5), k438(0), k438(2));
function k439(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(e / 3); } return b; }
p(439, k439(1.5), k439(0), k439(2));
function k440(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(d); } return b; }
p(440, k440(1.5), k440(0), k440(2));
function k441(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(e); } return b; }
p(441, k441(1.5), k441(0), k441(2));
function k442(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(i); } return b; }
p(442, k442(1.5), k442(0), k442(2));
function k443(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(i / 2); } return b; }
p(443, k443(1.5), k443(0), k443(2));
function k444(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(-i / 2); } return b; }
p(444, k444(1.5), k444(0), k444(2));
function k445(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(b); } return b; }
p(445, k445(1.5), k445(0), k445(2));
function k446(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(y); } return b; }
p(446, k446(1.5), k446(0), k446(2));
function k447(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(y / 2); } return b; }
p(447, k447(1.5), k447(0), k447(2));
function k448(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(0.5); } return b; }
p(448, k448(1.5), k448(0), k448(2));
function k449(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(-0.5); } return b; }
p(449, k449(1.5), k449(0), k449(2));
function k450(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(d * 0.5); } return b; }
p(450, k450(1.5), k450(0), k450(2));
function k451(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(NaN); } return b; }
p(451, k451(1.5), k451(0), k451(2));
function k452(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(1e300); } return b; }
p(452, k452(1.5), k452(0), k452(2));
function k453(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(-0); } return b; }
p(453, k453(1.5), k453(0), k453(2));
function k454(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(d % 3); } return b; }
p(454, k454(1.5), k454(0), k454(2));
function k455(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(i - 2); } return b; }
p(455, k455(1.5), k455(0), k455(2));
function k456(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(d / 3 + i); } return b; }
p(456, k456(1.5), k456(0), k456(2));
function k457(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround((d / 3) | 0); } return b; }
p(457, k457(1.5), k457(0), k457(2));
function k458(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(2.5 - d / 2); } return b; }
p(458, k458(1.5), k458(0), k458(2));
function k459(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(Infinity); } return b; }
p(459, k459(1.5), k459(0), k459(2));
function k460(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.fround(-d / 7); } return b; }
p(460, k460(1.5), k460(0), k460(2));
function k461(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(d / 3); } return b; }
p(461, k461(1.5), k461(0), k461(2));
function k462(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(e / 3); } return b; }
p(462, k462(1.5), k462(0), k462(2));
function k463(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(d); } return b; }
p(463, k463(1.5), k463(0), k463(2));
function k464(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(e); } return b; }
p(464, k464(1.5), k464(0), k464(2));
function k465(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(i); } return b; }
p(465, k465(1.5), k465(0), k465(2));
function k466(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(i / 2); } return b; }
p(466, k466(1.5), k466(0), k466(2));
function k467(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(-i / 2); } return b; }
p(467, k467(1.5), k467(0), k467(2));
function k468(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(b); } return b; }
p(468, k468(1.5), k468(0), k468(2));
function k469(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(y); } return b; }
p(469, k469(1.5), k469(0), k469(2));
function k470(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(y / 2); } return b; }
p(470, k470(1.5), k470(0), k470(2));
function k471(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(0.5); } return b; }
p(471, k471(1.5), k471(0), k471(2));
function k472(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(-0.5); } return b; }
p(472, k472(1.5), k472(0), k472(2));
function k473(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(d * 0.5); } return b; }
p(473, k473(1.5), k473(0), k473(2));
function k474(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(NaN); } return b; }
p(474, k474(1.5), k474(0), k474(2));
function k475(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(1e300); } return b; }
p(475, k475(1.5), k475(0), k475(2));
function k476(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(-0); } return b; }
p(476, k476(1.5), k476(0), k476(2));
function k477(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(d % 3); } return b; }
p(477, k477(1.5), k477(0), k477(2));
function k478(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(i - 2); } return b; }
p(478, k478(1.5), k478(0), k478(2));
function k479(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(d / 3 + i); } return b; }
p(479, k479(1.5), k479(0), k479(2));
function k480(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log((d / 3) | 0); } return b; }
p(480, k480(1.5), k480(0), k480(2));
function k481(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(2.5 - d / 2); } return b; }
p(481, k481(1.5), k481(0), k481(2));
function k482(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(Infinity); } return b; }
p(482, k482(1.5), k482(0), k482(2));
function k483(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log(-d / 7); } return b; }
p(483, k483(1.5), k483(0), k483(2));
function k484(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(d / 3); } return b; }
p(484, k484(1.5), k484(0), k484(2));
function k485(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(e / 3); } return b; }
p(485, k485(1.5), k485(0), k485(2));
function k486(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(d); } return b; }
p(486, k486(1.5), k486(0), k486(2));
function k487(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(e); } return b; }
p(487, k487(1.5), k487(0), k487(2));
function k488(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(i); } return b; }
p(488, k488(1.5), k488(0), k488(2));
function k489(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(i / 2); } return b; }
p(489, k489(1.5), k489(0), k489(2));
function k490(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(-i / 2); } return b; }
p(490, k490(1.5), k490(0), k490(2));
function k491(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(b); } return b; }
p(491, k491(1.5), k491(0), k491(2));
function k492(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(y); } return b; }
p(492, k492(1.5), k492(0), k492(2));
function k493(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(y / 2); } return b; }
p(493, k493(1.5), k493(0), k493(2));
function k494(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(0.5); } return b; }
p(494, k494(1.5), k494(0), k494(2));
function k495(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(-0.5); } return b; }
p(495, k495(1.5), k495(0), k495(2));
function k496(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(d * 0.5); } return b; }
p(496, k496(1.5), k496(0), k496(2));
function k497(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(NaN); } return b; }
p(497, k497(1.5), k497(0), k497(2));
function k498(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(1e300); } return b; }
p(498, k498(1.5), k498(0), k498(2));
function k499(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(-0); } return b; }
p(499, k499(1.5), k499(0), k499(2));
function k500(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(d % 3); } return b; }
p(500, k500(1.5), k500(0), k500(2));
function k501(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(i - 2); } return b; }
p(501, k501(1.5), k501(0), k501(2));
function k502(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(d / 3 + i); } return b; }
p(502, k502(1.5), k502(0), k502(2));
function k503(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10((d / 3) | 0); } return b; }
p(503, k503(1.5), k503(0), k503(2));
function k504(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(2.5 - d / 2); } return b; }
p(504, k504(1.5), k504(0), k504(2));
function k505(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(Infinity); } return b; }
p(505, k505(1.5), k505(0), k505(2));
function k506(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log10(-d / 7); } return b; }
p(506, k506(1.5), k506(0), k506(2));
function k507(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(d / 3); } return b; }
p(507, k507(1.5), k507(0), k507(2));
function k508(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(e / 3); } return b; }
p(508, k508(1.5), k508(0), k508(2));
function k509(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(d); } return b; }
p(509, k509(1.5), k509(0), k509(2));
function k510(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(e); } return b; }
p(510, k510(1.5), k510(0), k510(2));
function k511(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(i); } return b; }
p(511, k511(1.5), k511(0), k511(2));
function k512(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(i / 2); } return b; }
p(512, k512(1.5), k512(0), k512(2));
function k513(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(-i / 2); } return b; }
p(513, k513(1.5), k513(0), k513(2));
function k514(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(b); } return b; }
p(514, k514(1.5), k514(0), k514(2));
function k515(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(y); } return b; }
p(515, k515(1.5), k515(0), k515(2));
function k516(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(y / 2); } return b; }
p(516, k516(1.5), k516(0), k516(2));
function k517(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(0.5); } return b; }
p(517, k517(1.5), k517(0), k517(2));
function k518(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(-0.5); } return b; }
p(518, k518(1.5), k518(0), k518(2));
function k519(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(d * 0.5); } return b; }
p(519, k519(1.5), k519(0), k519(2));
function k520(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(NaN); } return b; }
p(520, k520(1.5), k520(0), k520(2));
function k521(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(1e300); } return b; }
p(521, k521(1.5), k521(0), k521(2));
function k522(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(-0); } return b; }
p(522, k522(1.5), k522(0), k522(2));
function k523(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(d % 3); } return b; }
p(523, k523(1.5), k523(0), k523(2));
function k524(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(i - 2); } return b; }
p(524, k524(1.5), k524(0), k524(2));
function k525(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(d / 3 + i); } return b; }
p(525, k525(1.5), k525(0), k525(2));
function k526(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p((d / 3) | 0); } return b; }
p(526, k526(1.5), k526(0), k526(2));
function k527(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(2.5 - d / 2); } return b; }
p(527, k527(1.5), k527(0), k527(2));
function k528(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(Infinity); } return b; }
p(528, k528(1.5), k528(0), k528(2));
function k529(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log1p(-d / 7); } return b; }
p(529, k529(1.5), k529(0), k529(2));
function k530(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(d / 3); } return b; }
p(530, k530(1.5), k530(0), k530(2));
function k531(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(e / 3); } return b; }
p(531, k531(1.5), k531(0), k531(2));
function k532(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(d); } return b; }
p(532, k532(1.5), k532(0), k532(2));
function k533(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(e); } return b; }
p(533, k533(1.5), k533(0), k533(2));
function k534(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(i); } return b; }
p(534, k534(1.5), k534(0), k534(2));
function k535(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(i / 2); } return b; }
p(535, k535(1.5), k535(0), k535(2));
function k536(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(-i / 2); } return b; }
p(536, k536(1.5), k536(0), k536(2));
function k537(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(b); } return b; }
p(537, k537(1.5), k537(0), k537(2));
function k538(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(y); } return b; }
p(538, k538(1.5), k538(0), k538(2));
function k539(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(y / 2); } return b; }
p(539, k539(1.5), k539(0), k539(2));
function k540(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(0.5); } return b; }
p(540, k540(1.5), k540(0), k540(2));
function k541(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(-0.5); } return b; }
p(541, k541(1.5), k541(0), k541(2));
function k542(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(d * 0.5); } return b; }
p(542, k542(1.5), k542(0), k542(2));
function k543(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(NaN); } return b; }
p(543, k543(1.5), k543(0), k543(2));
function k544(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(1e300); } return b; }
p(544, k544(1.5), k544(0), k544(2));
function k545(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(-0); } return b; }
p(545, k545(1.5), k545(0), k545(2));
function k546(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(d % 3); } return b; }
p(546, k546(1.5), k546(0), k546(2));
function k547(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(i - 2); } return b; }
p(547, k547(1.5), k547(0), k547(2));
function k548(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(d / 3 + i); } return b; }
p(548, k548(1.5), k548(0), k548(2));
function k549(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2((d / 3) | 0); } return b; }
p(549, k549(1.5), k549(0), k549(2));
function k550(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(2.5 - d / 2); } return b; }
p(550, k550(1.5), k550(0), k550(2));
function k551(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(Infinity); } return b; }
p(551, k551(1.5), k551(0), k551(2));
function k552(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.log2(-d / 7); } return b; }
p(552, k552(1.5), k552(0), k552(2));
function k553(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d / 3); } return b; }
p(553, k553(1.5), k553(0), k553(2));
function k554(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d / 3); } return b; }
p(554, k554(1.5), k554(0), k554(2));
function k555(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(e / 3); } return b; }
p(555, k555(1.5), k555(0), k555(2));
function k556(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(e / 3); } return b; }
p(556, k556(1.5), k556(0), k556(2));
function k557(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d); } return b; }
p(557, k557(1.5), k557(0), k557(2));
function k558(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d); } return b; }
p(558, k558(1.5), k558(0), k558(2));
function k559(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(e); } return b; }
p(559, k559(1.5), k559(0), k559(2));
function k560(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(e); } return b; }
p(560, k560(1.5), k560(0), k560(2));
function k561(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(i); } return b; }
p(561, k561(1.5), k561(0), k561(2));
function k562(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(i); } return b; }
p(562, k562(1.5), k562(0), k562(2));
function k563(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(i / 2); } return b; }
p(563, k563(1.5), k563(0), k563(2));
function k564(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(i / 2); } return b; }
p(564, k564(1.5), k564(0), k564(2));
function k565(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-i / 2); } return b; }
p(565, k565(1.5), k565(0), k565(2));
function k566(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-i / 2); } return b; }
p(566, k566(1.5), k566(0), k566(2));
function k567(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(b); } return b; }
p(567, k567(1.5), k567(0), k567(2));
function k568(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(b); } return b; }
p(568, k568(1.5), k568(0), k568(2));
function k569(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(y); } return b; }
p(569, k569(1.5), k569(0), k569(2));
function k570(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(y); } return b; }
p(570, k570(1.5), k570(0), k570(2));
function k571(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(y / 2); } return b; }
p(571, k571(1.5), k571(0), k571(2));
function k572(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(y / 2); } return b; }
p(572, k572(1.5), k572(0), k572(2));
function k573(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(0.5); } return b; }
p(573, k573(1.5), k573(0), k573(2));
function k574(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(0.5); } return b; }
p(574, k574(1.5), k574(0), k574(2));
function k575(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-0.5); } return b; }
p(575, k575(1.5), k575(0), k575(2));
function k576(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-0.5); } return b; }
p(576, k576(1.5), k576(0), k576(2));
function k577(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d * 0.5); } return b; }
p(577, k577(1.5), k577(0), k577(2));
function k578(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d * 0.5); } return b; }
p(578, k578(1.5), k578(0), k578(2));
function k579(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(NaN); } return b; }
p(579, k579(1.5), k579(0), k579(2));
function k580(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(NaN); } return b; }
p(580, k580(1.5), k580(0), k580(2));
function k581(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(1e300); } return b; }
p(581, k581(1.5), k581(0), k581(2));
function k582(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(1e300); } return b; }
p(582, k582(1.5), k582(0), k582(2));
function k583(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-0); } return b; }
p(583, k583(1.5), k583(0), k583(2));
function k584(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-0); } return b; }
p(584, k584(1.5), k584(0), k584(2));
function k585(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d % 3); } return b; }
p(585, k585(1.5), k585(0), k585(2));
function k586(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d % 3); } return b; }
p(586, k586(1.5), k586(0), k586(2));
function k587(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(i - 2); } return b; }
p(587, k587(1.5), k587(0), k587(2));
function k588(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(i - 2); } return b; }
p(588, k588(1.5), k588(0), k588(2));
function k589(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d / 3 + i); } return b; }
p(589, k589(1.5), k589(0), k589(2));
function k590(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(d / 3 + i); } return b; }
p(590, k590(1.5), k590(0), k590(2));
function k591(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round((d / 3) | 0); } return b; }
p(591, k591(1.5), k591(0), k591(2));
function k592(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round((d / 3) | 0); } return b; }
p(592, k592(1.5), k592(0), k592(2));
function k593(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(2.5 - d / 2); } return b; }
p(593, k593(1.5), k593(0), k593(2));
function k594(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(2.5 - d / 2); } return b; }
p(594, k594(1.5), k594(0), k594(2));
function k595(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(Infinity); } return b; }
p(595, k595(1.5), k595(0), k595(2));
function k596(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(Infinity); } return b; }
p(596, k596(1.5), k596(0), k596(2));
function k597(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-d / 7); } return b; }
p(597, k597(1.5), k597(0), k597(2));
function k598(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.round(-d / 7); } return b; }
p(598, k598(1.5), k598(0), k598(2));
function k599(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d / 3); } return b; }
p(599, k599(1.5), k599(0), k599(2));
function k600(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d / 3); } return b; }
p(600, k600(1.5), k600(0), k600(2));
function k601(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(e / 3); } return b; }
p(601, k601(1.5), k601(0), k601(2));
function k602(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(e / 3); } return b; }
p(602, k602(1.5), k602(0), k602(2));
function k603(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d); } return b; }
p(603, k603(1.5), k603(0), k603(2));
function k604(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d); } return b; }
p(604, k604(1.5), k604(0), k604(2));
function k605(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(e); } return b; }
p(605, k605(1.5), k605(0), k605(2));
function k606(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(e); } return b; }
p(606, k606(1.5), k606(0), k606(2));
function k607(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(i); } return b; }
p(607, k607(1.5), k607(0), k607(2));
function k608(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(i); } return b; }
p(608, k608(1.5), k608(0), k608(2));
function k609(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(i / 2); } return b; }
p(609, k609(1.5), k609(0), k609(2));
function k610(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(i / 2); } return b; }
p(610, k610(1.5), k610(0), k610(2));
function k611(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-i / 2); } return b; }
p(611, k611(1.5), k611(0), k611(2));
function k612(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-i / 2); } return b; }
p(612, k612(1.5), k612(0), k612(2));
function k613(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(b); } return b; }
p(613, k613(1.5), k613(0), k613(2));
function k614(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(b); } return b; }
p(614, k614(1.5), k614(0), k614(2));
function k615(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(y); } return b; }
p(615, k615(1.5), k615(0), k615(2));
function k616(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(y); } return b; }
p(616, k616(1.5), k616(0), k616(2));
function k617(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(y / 2); } return b; }
p(617, k617(1.5), k617(0), k617(2));
function k618(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(y / 2); } return b; }
p(618, k618(1.5), k618(0), k618(2));
function k619(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(0.5); } return b; }
p(619, k619(1.5), k619(0), k619(2));
function k620(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(0.5); } return b; }
p(620, k620(1.5), k620(0), k620(2));
function k621(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-0.5); } return b; }
p(621, k621(1.5), k621(0), k621(2));
function k622(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-0.5); } return b; }
p(622, k622(1.5), k622(0), k622(2));
function k623(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d * 0.5); } return b; }
p(623, k623(1.5), k623(0), k623(2));
function k624(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d * 0.5); } return b; }
p(624, k624(1.5), k624(0), k624(2));
function k625(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(NaN); } return b; }
p(625, k625(1.5), k625(0), k625(2));
function k626(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(NaN); } return b; }
p(626, k626(1.5), k626(0), k626(2));
function k627(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(1e300); } return b; }
p(627, k627(1.5), k627(0), k627(2));
function k628(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(1e300); } return b; }
p(628, k628(1.5), k628(0), k628(2));
function k629(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-0); } return b; }
p(629, k629(1.5), k629(0), k629(2));
function k630(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-0); } return b; }
p(630, k630(1.5), k630(0), k630(2));
function k631(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d % 3); } return b; }
p(631, k631(1.5), k631(0), k631(2));
function k632(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d % 3); } return b; }
p(632, k632(1.5), k632(0), k632(2));
function k633(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(i - 2); } return b; }
p(633, k633(1.5), k633(0), k633(2));
function k634(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(i - 2); } return b; }
p(634, k634(1.5), k634(0), k634(2));
function k635(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d / 3 + i); } return b; }
p(635, k635(1.5), k635(0), k635(2));
function k636(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(d / 3 + i); } return b; }
p(636, k636(1.5), k636(0), k636(2));
function k637(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign((d / 3) | 0); } return b; }
p(637, k637(1.5), k637(0), k637(2));
function k638(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign((d / 3) | 0); } return b; }
p(638, k638(1.5), k638(0), k638(2));
function k639(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(2.5 - d / 2); } return b; }
p(639, k639(1.5), k639(0), k639(2));
function k640(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(2.5 - d / 2); } return b; }
p(640, k640(1.5), k640(0), k640(2));
function k641(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(Infinity); } return b; }
p(641, k641(1.5), k641(0), k641(2));
function k642(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(Infinity); } return b; }
p(642, k642(1.5), k642(0), k642(2));
function k643(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-d / 7); } return b; }
p(643, k643(1.5), k643(0), k643(2));
function k644(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sign(-d / 7); } return b; }
p(644, k644(1.5), k644(0), k644(2));
function k645(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(d / 3); } return b; }
p(645, k645(1.5), k645(0), k645(2));
function k646(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(e / 3); } return b; }
p(646, k646(1.5), k646(0), k646(2));
function k647(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(d); } return b; }
p(647, k647(1.5), k647(0), k647(2));
function k648(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(e); } return b; }
p(648, k648(1.5), k648(0), k648(2));
function k649(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(i); } return b; }
p(649, k649(1.5), k649(0), k649(2));
function k650(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(i / 2); } return b; }
p(650, k650(1.5), k650(0), k650(2));
function k651(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(-i / 2); } return b; }
p(651, k651(1.5), k651(0), k651(2));
function k652(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(b); } return b; }
p(652, k652(1.5), k652(0), k652(2));
function k653(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(y); } return b; }
p(653, k653(1.5), k653(0), k653(2));
function k654(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(y / 2); } return b; }
p(654, k654(1.5), k654(0), k654(2));
function k655(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(0.5); } return b; }
p(655, k655(1.5), k655(0), k655(2));
function k656(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(-0.5); } return b; }
p(656, k656(1.5), k656(0), k656(2));
function k657(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(d * 0.5); } return b; }
p(657, k657(1.5), k657(0), k657(2));
function k658(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(NaN); } return b; }
p(658, k658(1.5), k658(0), k658(2));
function k659(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(1e300); } return b; }
p(659, k659(1.5), k659(0), k659(2));
function k660(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(-0); } return b; }
p(660, k660(1.5), k660(0), k660(2));
function k661(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(d % 3); } return b; }
p(661, k661(1.5), k661(0), k661(2));
function k662(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(i - 2); } return b; }
p(662, k662(1.5), k662(0), k662(2));
function k663(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(d / 3 + i); } return b; }
p(663, k663(1.5), k663(0), k663(2));
function k664(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin((d / 3) | 0); } return b; }
p(664, k664(1.5), k664(0), k664(2));
function k665(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(2.5 - d / 2); } return b; }
p(665, k665(1.5), k665(0), k665(2));
function k666(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(Infinity); } return b; }
p(666, k666(1.5), k666(0), k666(2));
function k667(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sin(-d / 7); } return b; }
p(667, k667(1.5), k667(0), k667(2));
function k668(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(d / 3); } return b; }
p(668, k668(1.5), k668(0), k668(2));
function k669(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(e / 3); } return b; }
p(669, k669(1.5), k669(0), k669(2));
function k670(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(d); } return b; }
p(670, k670(1.5), k670(0), k670(2));
function k671(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(e); } return b; }
p(671, k671(1.5), k671(0), k671(2));
function k672(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(i); } return b; }
p(672, k672(1.5), k672(0), k672(2));
function k673(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(i / 2); } return b; }
p(673, k673(1.5), k673(0), k673(2));
function k674(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(-i / 2); } return b; }
p(674, k674(1.5), k674(0), k674(2));
function k675(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(b); } return b; }
p(675, k675(1.5), k675(0), k675(2));
function k676(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(y); } return b; }
p(676, k676(1.5), k676(0), k676(2));
function k677(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(y / 2); } return b; }
p(677, k677(1.5), k677(0), k677(2));
function k678(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(0.5); } return b; }
p(678, k678(1.5), k678(0), k678(2));
function k679(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(-0.5); } return b; }
p(679, k679(1.5), k679(0), k679(2));
function k680(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(d * 0.5); } return b; }
p(680, k680(1.5), k680(0), k680(2));
function k681(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(NaN); } return b; }
p(681, k681(1.5), k681(0), k681(2));
function k682(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(1e300); } return b; }
p(682, k682(1.5), k682(0), k682(2));
function k683(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(-0); } return b; }
p(683, k683(1.5), k683(0), k683(2));
function k684(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(d % 3); } return b; }
p(684, k684(1.5), k684(0), k684(2));
function k685(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(i - 2); } return b; }
p(685, k685(1.5), k685(0), k685(2));
function k686(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(d / 3 + i); } return b; }
p(686, k686(1.5), k686(0), k686(2));
function k687(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh((d / 3) | 0); } return b; }
p(687, k687(1.5), k687(0), k687(2));
function k688(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(2.5 - d / 2); } return b; }
p(688, k688(1.5), k688(0), k688(2));
function k689(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(Infinity); } return b; }
p(689, k689(1.5), k689(0), k689(2));
function k690(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sinh(-d / 7); } return b; }
p(690, k690(1.5), k690(0), k690(2));
function k691(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(d / 3); } return b; }
p(691, k691(1.5), k691(0), k691(2));
function k692(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(e / 3); } return b; }
p(692, k692(1.5), k692(0), k692(2));
function k693(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(d); } return b; }
p(693, k693(1.5), k693(0), k693(2));
function k694(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(e); } return b; }
p(694, k694(1.5), k694(0), k694(2));
function k695(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(i); } return b; }
p(695, k695(1.5), k695(0), k695(2));
function k696(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(i / 2); } return b; }
p(696, k696(1.5), k696(0), k696(2));
function k697(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(-i / 2); } return b; }
p(697, k697(1.5), k697(0), k697(2));
function k698(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(b); } return b; }
p(698, k698(1.5), k698(0), k698(2));
function k699(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(y); } return b; }
p(699, k699(1.5), k699(0), k699(2));
function k700(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(y / 2); } return b; }
p(700, k700(1.5), k700(0), k700(2));
function k701(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(0.5); } return b; }
p(701, k701(1.5), k701(0), k701(2));
function k702(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(-0.5); } return b; }
p(702, k702(1.5), k702(0), k702(2));
function k703(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(d * 0.5); } return b; }
p(703, k703(1.5), k703(0), k703(2));
function k704(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(NaN); } return b; }
p(704, k704(1.5), k704(0), k704(2));
function k705(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(1e300); } return b; }
p(705, k705(1.5), k705(0), k705(2));
function k706(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(-0); } return b; }
p(706, k706(1.5), k706(0), k706(2));
function k707(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(d % 3); } return b; }
p(707, k707(1.5), k707(0), k707(2));
function k708(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(i - 2); } return b; }
p(708, k708(1.5), k708(0), k708(2));
function k709(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(d / 3 + i); } return b; }
p(709, k709(1.5), k709(0), k709(2));
function k710(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt((d / 3) | 0); } return b; }
p(710, k710(1.5), k710(0), k710(2));
function k711(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(2.5 - d / 2); } return b; }
p(711, k711(1.5), k711(0), k711(2));
function k712(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(Infinity); } return b; }
p(712, k712(1.5), k712(0), k712(2));
function k713(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.sqrt(-d / 7); } return b; }
p(713, k713(1.5), k713(0), k713(2));
function k714(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(d / 3); } return b; }
p(714, k714(1.5), k714(0), k714(2));
function k715(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(e / 3); } return b; }
p(715, k715(1.5), k715(0), k715(2));
function k716(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(d); } return b; }
p(716, k716(1.5), k716(0), k716(2));
function k717(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(e); } return b; }
p(717, k717(1.5), k717(0), k717(2));
function k718(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(i); } return b; }
p(718, k718(1.5), k718(0), k718(2));
function k719(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(i / 2); } return b; }
p(719, k719(1.5), k719(0), k719(2));
function k720(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(-i / 2); } return b; }
p(720, k720(1.5), k720(0), k720(2));
function k721(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(b); } return b; }
p(721, k721(1.5), k721(0), k721(2));
function k722(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(y); } return b; }
p(722, k722(1.5), k722(0), k722(2));
function k723(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(y / 2); } return b; }
p(723, k723(1.5), k723(0), k723(2));
function k724(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(0.5); } return b; }
p(724, k724(1.5), k724(0), k724(2));
function k725(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(-0.5); } return b; }
p(725, k725(1.5), k725(0), k725(2));
function k726(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(d * 0.5); } return b; }
p(726, k726(1.5), k726(0), k726(2));
function k727(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(NaN); } return b; }
p(727, k727(1.5), k727(0), k727(2));
function k728(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(1e300); } return b; }
p(728, k728(1.5), k728(0), k728(2));
function k729(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(-0); } return b; }
p(729, k729(1.5), k729(0), k729(2));
function k730(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(d % 3); } return b; }
p(730, k730(1.5), k730(0), k730(2));
function k731(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(i - 2); } return b; }
p(731, k731(1.5), k731(0), k731(2));
function k732(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(d / 3 + i); } return b; }
p(732, k732(1.5), k732(0), k732(2));
function k733(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan((d / 3) | 0); } return b; }
p(733, k733(1.5), k733(0), k733(2));
function k734(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(2.5 - d / 2); } return b; }
p(734, k734(1.5), k734(0), k734(2));
function k735(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(Infinity); } return b; }
p(735, k735(1.5), k735(0), k735(2));
function k736(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tan(-d / 7); } return b; }
p(736, k736(1.5), k736(0), k736(2));
function k737(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(d / 3); } return b; }
p(737, k737(1.5), k737(0), k737(2));
function k738(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(e / 3); } return b; }
p(738, k738(1.5), k738(0), k738(2));
function k739(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(d); } return b; }
p(739, k739(1.5), k739(0), k739(2));
function k740(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(e); } return b; }
p(740, k740(1.5), k740(0), k740(2));
function k741(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(i); } return b; }
p(741, k741(1.5), k741(0), k741(2));
function k742(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(i / 2); } return b; }
p(742, k742(1.5), k742(0), k742(2));
function k743(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(-i / 2); } return b; }
p(743, k743(1.5), k743(0), k743(2));
function k744(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(b); } return b; }
p(744, k744(1.5), k744(0), k744(2));
function k745(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(y); } return b; }
p(745, k745(1.5), k745(0), k745(2));
function k746(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(y / 2); } return b; }
p(746, k746(1.5), k746(0), k746(2));
function k747(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(0.5); } return b; }
p(747, k747(1.5), k747(0), k747(2));
function k748(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(-0.5); } return b; }
p(748, k748(1.5), k748(0), k748(2));
function k749(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(d * 0.5); } return b; }
p(749, k749(1.5), k749(0), k749(2));
function k750(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(NaN); } return b; }
p(750, k750(1.5), k750(0), k750(2));
function k751(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(1e300); } return b; }
p(751, k751(1.5), k751(0), k751(2));
function k752(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(-0); } return b; }
p(752, k752(1.5), k752(0), k752(2));
function k753(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(d % 3); } return b; }
p(753, k753(1.5), k753(0), k753(2));
function k754(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(i - 2); } return b; }
p(754, k754(1.5), k754(0), k754(2));
function k755(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(d / 3 + i); } return b; }
p(755, k755(1.5), k755(0), k755(2));
function k756(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh((d / 3) | 0); } return b; }
p(756, k756(1.5), k756(0), k756(2));
function k757(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(2.5 - d / 2); } return b; }
p(757, k757(1.5), k757(0), k757(2));
function k758(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(Infinity); } return b; }
p(758, k758(1.5), k758(0), k758(2));
function k759(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.tanh(-d / 7); } return b; }
p(759, k759(1.5), k759(0), k759(2));
function k760(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d / 3); } return b; }
p(760, k760(1.5), k760(0), k760(2));
function k761(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d / 3); } return b; }
p(761, k761(1.5), k761(0), k761(2));
function k762(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(e / 3); } return b; }
p(762, k762(1.5), k762(0), k762(2));
function k763(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(e / 3); } return b; }
p(763, k763(1.5), k763(0), k763(2));
function k764(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d); } return b; }
p(764, k764(1.5), k764(0), k764(2));
function k765(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d); } return b; }
p(765, k765(1.5), k765(0), k765(2));
function k766(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(e); } return b; }
p(766, k766(1.5), k766(0), k766(2));
function k767(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(e); } return b; }
p(767, k767(1.5), k767(0), k767(2));
function k768(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(i); } return b; }
p(768, k768(1.5), k768(0), k768(2));
function k769(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(i); } return b; }
p(769, k769(1.5), k769(0), k769(2));
function k770(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(i / 2); } return b; }
p(770, k770(1.5), k770(0), k770(2));
function k771(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(i / 2); } return b; }
p(771, k771(1.5), k771(0), k771(2));
function k772(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-i / 2); } return b; }
p(772, k772(1.5), k772(0), k772(2));
function k773(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-i / 2); } return b; }
p(773, k773(1.5), k773(0), k773(2));
function k774(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(b); } return b; }
p(774, k774(1.5), k774(0), k774(2));
function k775(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(b); } return b; }
p(775, k775(1.5), k775(0), k775(2));
function k776(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(y); } return b; }
p(776, k776(1.5), k776(0), k776(2));
function k777(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(y); } return b; }
p(777, k777(1.5), k777(0), k777(2));
function k778(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(y / 2); } return b; }
p(778, k778(1.5), k778(0), k778(2));
function k779(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(y / 2); } return b; }
p(779, k779(1.5), k779(0), k779(2));
function k780(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(0.5); } return b; }
p(780, k780(1.5), k780(0), k780(2));
function k781(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(0.5); } return b; }
p(781, k781(1.5), k781(0), k781(2));
function k782(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-0.5); } return b; }
p(782, k782(1.5), k782(0), k782(2));
function k783(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-0.5); } return b; }
p(783, k783(1.5), k783(0), k783(2));
function k784(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d * 0.5); } return b; }
p(784, k784(1.5), k784(0), k784(2));
function k785(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d * 0.5); } return b; }
p(785, k785(1.5), k785(0), k785(2));
function k786(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(NaN); } return b; }
p(786, k786(1.5), k786(0), k786(2));
function k787(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(NaN); } return b; }
p(787, k787(1.5), k787(0), k787(2));
function k788(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(1e300); } return b; }
p(788, k788(1.5), k788(0), k788(2));
function k789(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(1e300); } return b; }
p(789, k789(1.5), k789(0), k789(2));
function k790(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-0); } return b; }
p(790, k790(1.5), k790(0), k790(2));
function k791(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-0); } return b; }
p(791, k791(1.5), k791(0), k791(2));
function k792(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d % 3); } return b; }
p(792, k792(1.5), k792(0), k792(2));
function k793(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d % 3); } return b; }
p(793, k793(1.5), k793(0), k793(2));
function k794(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(i - 2); } return b; }
p(794, k794(1.5), k794(0), k794(2));
function k795(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(i - 2); } return b; }
p(795, k795(1.5), k795(0), k795(2));
function k796(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d / 3 + i); } return b; }
p(796, k796(1.5), k796(0), k796(2));
function k797(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(d / 3 + i); } return b; }
p(797, k797(1.5), k797(0), k797(2));
function k798(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc((d / 3) | 0); } return b; }
p(798, k798(1.5), k798(0), k798(2));
function k799(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc((d / 3) | 0); } return b; }
p(799, k799(1.5), k799(0), k799(2));
function k800(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(2.5 - d / 2); } return b; }
p(800, k800(1.5), k800(0), k800(2));
function k801(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(2.5 - d / 2); } return b; }
p(801, k801(1.5), k801(0), k801(2));
function k802(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(Infinity); } return b; }
p(802, k802(1.5), k802(0), k802(2));
function k803(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(Infinity); } return b; }
p(803, k803(1.5), k803(0), k803(2));
function k804(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-d / 7); } return b; }
p(804, k804(1.5), k804(0), k804(2));
function k805(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.trunc(-d / 7); } return b; }
p(805, k805(1.5), k805(0), k805(2));
function k806(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(d / 3, i); } return b; }
p(806, k806(1.5), k806(0), k806(2));
function k807(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(i, d / 3); } return b; }
p(807, k807(1.5), k807(0), k807(2));
function k808(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(b, i); } return b; }
p(808, k808(1.5), k808(0), k808(2));
function k809(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(e / 3, 0.5); } return b; }
p(809, k809(1.5), k809(0), k809(2));
function k810(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(d, e); } return b; }
p(810, k810(1.5), k810(0), k810(2));
function k811(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(y, i / 2); } return b; }
p(811, k811(1.5), k811(0), k811(2));
function k812(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(d / 3, e / 3); } return b; }
p(812, k812(1.5), k812(0), k812(2));
function k813(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(-0, 0); } return b; }
p(813, k813(1.5), k813(0), k813(2));
function k814(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(NaN, d / 3); } return b; }
p(814, k814(1.5), k814(0), k814(2));
function k815(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.atan2(i / 2, i); } return b; }
p(815, k815(1.5), k815(0), k815(2));
function k816(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(d / 3, i); } return b; }
p(816, k816(1.5), k816(0), k816(2));
function k817(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(i, d / 3); } return b; }
p(817, k817(1.5), k817(0), k817(2));
function k818(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(b, i); } return b; }
p(818, k818(1.5), k818(0), k818(2));
function k819(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(e / 3, 0.5); } return b; }
p(819, k819(1.5), k819(0), k819(2));
function k820(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(d, e); } return b; }
p(820, k820(1.5), k820(0), k820(2));
function k821(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(y, i / 2); } return b; }
p(821, k821(1.5), k821(0), k821(2));
function k822(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(d / 3, e / 3); } return b; }
p(822, k822(1.5), k822(0), k822(2));
function k823(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(-0, 0); } return b; }
p(823, k823(1.5), k823(0), k823(2));
function k824(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(NaN, d / 3); } return b; }
p(824, k824(1.5), k824(0), k824(2));
function k825(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.imul(i / 2, i); } return b; }
p(825, k825(1.5), k825(0), k825(2));
function k826(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, i); } return b; }
p(826, k826(1.5), k826(0), k826(2));
function k827(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, i); } return b; }
p(827, k827(1.5), k827(0), k827(2));
function k828(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(i, d / 3); } return b; }
p(828, k828(1.5), k828(0), k828(2));
function k829(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(i, d / 3); } return b; }
p(829, k829(1.5), k829(0), k829(2));
function k830(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(b, i); } return b; }
p(830, k830(1.5), k830(0), k830(2));
function k831(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(b, i); } return b; }
p(831, k831(1.5), k831(0), k831(2));
function k832(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(e / 3, 0.5); } return b; }
p(832, k832(1.5), k832(0), k832(2));
function k833(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(e / 3, 0.5); } return b; }
p(833, k833(1.5), k833(0), k833(2));
function k834(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d, e); } return b; }
p(834, k834(1.5), k834(0), k834(2));
function k835(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d, e); } return b; }
p(835, k835(1.5), k835(0), k835(2));
function k836(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(y, i / 2); } return b; }
p(836, k836(1.5), k836(0), k836(2));
function k837(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(y, i / 2); } return b; }
p(837, k837(1.5), k837(0), k837(2));
function k838(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, e / 3); } return b; }
p(838, k838(1.5), k838(0), k838(2));
function k839(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, e / 3); } return b; }
p(839, k839(1.5), k839(0), k839(2));
function k840(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(-0, 0); } return b; }
p(840, k840(1.5), k840(0), k840(2));
function k841(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(-0, 0); } return b; }
p(841, k841(1.5), k841(0), k841(2));
function k842(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(NaN, d / 3); } return b; }
p(842, k842(1.5), k842(0), k842(2));
function k843(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(NaN, d / 3); } return b; }
p(843, k843(1.5), k843(0), k843(2));
function k844(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(i / 2, i); } return b; }
p(844, k844(1.5), k844(0), k844(2));
function k845(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(i / 2, i); } return b; }
p(845, k845(1.5), k845(0), k845(2));
function k846(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, i); } return b; }
p(846, k846(1.5), k846(0), k846(2));
function k847(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, i); } return b; }
p(847, k847(1.5), k847(0), k847(2));
function k848(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(i, d / 3); } return b; }
p(848, k848(1.5), k848(0), k848(2));
function k849(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(i, d / 3); } return b; }
p(849, k849(1.5), k849(0), k849(2));
function k850(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(b, i); } return b; }
p(850, k850(1.5), k850(0), k850(2));
function k851(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(b, i); } return b; }
p(851, k851(1.5), k851(0), k851(2));
function k852(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(e / 3, 0.5); } return b; }
p(852, k852(1.5), k852(0), k852(2));
function k853(y: number) { let e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(e / 3, 0.5); } return b; }
p(853, k853(1.5), k853(0), k853(2));
function k854(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d, e); } return b; }
p(854, k854(1.5), k854(0), k854(2));
function k855(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d, e); } return b; }
p(855, k855(1.5), k855(0), k855(2));
function k856(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(y, i / 2); } return b; }
p(856, k856(1.5), k856(0), k856(2));
function k857(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(y, i / 2); } return b; }
p(857, k857(1.5), k857(0), k857(2));
function k858(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, e / 3); } return b; }
p(858, k858(1.5), k858(0), k858(2));
function k859(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, e / 3); } return b; }
p(859, k859(1.5), k859(0), k859(2));
function k860(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(-0, 0); } return b; }
p(860, k860(1.5), k860(0), k860(2));
function k861(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(-0, 0); } return b; }
p(861, k861(1.5), k861(0), k861(2));
function k862(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(NaN, d / 3); } return b; }
p(862, k862(1.5), k862(0), k862(2));
function k863(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(NaN, d / 3); } return b; }
p(863, k863(1.5), k863(0), k863(2));
function k864(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(i / 2, i); } return b; }
p(864, k864(1.5), k864(0), k864(2));
function k865(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(i / 2, i); } return b; }
p(865, k865(1.5), k865(0), k865(2));
function k866(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(d / 3, i); } return b; }
p(866, k866(1.5), k866(0), k866(2));
function k867(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(i, d / 3); } return b; }
p(867, k867(1.5), k867(0), k867(2));
function k868(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(b, i); } return b; }
p(868, k868(1.5), k868(0), k868(2));
function k869(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(e / 3, 0.5); } return b; }
p(869, k869(1.5), k869(0), k869(2));
function k870(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(d, e); } return b; }
p(870, k870(1.5), k870(0), k870(2));
function k871(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(y, i / 2); } return b; }
p(871, k871(1.5), k871(0), k871(2));
function k872(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(d / 3, e / 3); } return b; }
p(872, k872(1.5), k872(0), k872(2));
function k873(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(-0, 0); } return b; }
p(873, k873(1.5), k873(0), k873(2));
function k874(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(NaN, d / 3); } return b; }
p(874, k874(1.5), k874(0), k874(2));
function k875(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.pow(i / 2, i); } return b; }
p(875, k875(1.5), k875(0), k875(2));
function k876(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(d / 3, i); } return b; }
p(876, k876(1.5), k876(0), k876(2));
function k877(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(i, d / 3); } return b; }
p(877, k877(1.5), k877(0), k877(2));
function k878(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(b, i); } return b; }
p(878, k878(1.5), k878(0), k878(2));
function k879(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(e / 3, 0.5); } return b; }
p(879, k879(1.5), k879(0), k879(2));
function k880(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(d, e); } return b; }
p(880, k880(1.5), k880(0), k880(2));
function k881(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(y, i / 2); } return b; }
p(881, k881(1.5), k881(0), k881(2));
function k882(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(d / 3, e / 3); } return b; }
p(882, k882(1.5), k882(0), k882(2));
function k883(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(-0, 0); } return b; }
p(883, k883(1.5), k883(0), k883(2));
function k884(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(NaN, d / 3); } return b; }
p(884, k884(1.5), k884(0), k884(2));
function k885(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(i / 2, i); } return b; }
p(885, k885(1.5), k885(0), k885(2));
function k886(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(); } return b; }
p(886, k886(1.5), k886(0), k886(2));
function k887(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(); } return b; }
p(887, k887(1.5), k887(0), k887(2));
function k888(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3); } return b; }
p(888, k888(1.5), k888(0), k888(2));
function k889(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3); } return b; }
p(889, k889(1.5), k889(0), k889(2));
function k890(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, i, e / 3); } return b; }
p(890, k890(1.5), k890(0), k890(2));
function k891(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, i, e / 3); } return b; }
p(891, k891(1.5), k891(0), k891(2));
function k892(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, i, e / 3, b); } return b; }
p(892, k892(1.5), k892(0), k892(2));
function k893(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(d / 3, i, e / 3, b); } return b; }
p(893, k893(1.5), k893(0), k893(2));
function k894(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(...[d / 3, i]); } return b; }
p(894, k894(1.5), k894(0), k894(2));
function k895(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(...[d / 3, i]); } return b; }
p(895, k895(1.5), k895(0), k895(2));
function k896(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(); } return b; }
p(896, k896(1.5), k896(0), k896(2));
function k897(y: number) { let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(); } return b; }
p(897, k897(1.5), k897(0), k897(2));
function k898(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3); } return b; }
p(898, k898(1.5), k898(0), k898(2));
function k899(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3); } return b; }
p(899, k899(1.5), k899(0), k899(2));
function k900(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, i, e / 3); } return b; }
p(900, k900(1.5), k900(0), k900(2));
function k901(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, i, e / 3); } return b; }
p(901, k901(1.5), k901(0), k901(2));
function k902(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, i, e / 3, b); } return b; }
p(902, k902(1.5), k902(0), k902(2));
function k903(y: number) { let d: number = 7, e: number = -7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(d / 3, i, e / 3, b); } return b; }
p(903, k903(1.5), k903(0), k903(2));
function k904(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(...[d / 3, i]); } return b; }
p(904, k904(1.5), k904(0), k904(2));
function k905(y: number) { let d: number = 7; let b: number = y, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(...[d / 3, i]); } return b; }
p(905, k905(1.5), k905(0), k905(2));
function k906(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(); } return b; }
p(906, k906(1.5), k906(0), k906(2));
function k907(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(d / 3); } return b; }
p(907, k907(1.5), k907(0), k907(2));
function k908(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(d / 3, i, e / 3); } return b; }
p(908, k908(1.5), k908(0), k908(2));
function k909(y: number) { let d: number = 7, e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(d / 3, i, e / 3, b); } return b; }
p(909, k909(1.5), k909(0), k909(2));
function k910(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.hypot(...[d / 3, i]); } return b; }
p(910, k910(1.5), k910(0), k910(2));
function k911(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(d / 3); } return b; }
p(911, k911(1.5), k911(0), k911(2));
function k912(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(d / 3); } return b; }
p(912, k912(1.5), k912(0), k912(2));
function k913(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(d / 3); } return b; }
p(913, k913(1.5), k913(0), k913(2));
function k914(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) + 1; } return b; }
p(914, k914(1.5), k914(0), k914(2));
function k915(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) - 0.5; } return b; }
p(915, k915(1.5), k915(0), k915(2));
function k916(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) * 2; } return b; }
p(916, k916(1.5), k916(0), k916(2));
function k917(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) / 2; } return b; }
p(917, k917(1.5), k917(0), k917(2));
function k918(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) % 2; } return b; }
p(918, k918(1.5), k918(0), k918(2));
function k919(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) ** 2; } return b; }
p(919, k919(1.5), k919(0), k919(2));
function k920(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(d / 3); } return b; }
p(920, k920(1.5), k920(0), k920(2));
function k921(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) >>> 0; } return b; }
p(921, k921(1.5), k921(0), k921(2));
function k922(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3) | 0; } return b; }
p(922, k922(1.5), k922(0), k922(2));
function k923(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(e / 3); } return b; }
p(923, k923(1.5), k923(0), k923(2));
function k924(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(e / 3); } return b; }
p(924, k924(1.5), k924(0), k924(2));
function k925(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(e / 3); } return b; }
p(925, k925(1.5), k925(0), k925(2));
function k926(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) + 1; } return b; }
p(926, k926(1.5), k926(0), k926(2));
function k927(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) - 0.5; } return b; }
p(927, k927(1.5), k927(0), k927(2));
function k928(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) * 2; } return b; }
p(928, k928(1.5), k928(0), k928(2));
function k929(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) / 2; } return b; }
p(929, k929(1.5), k929(0), k929(2));
function k930(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) % 2; } return b; }
p(930, k930(1.5), k930(0), k930(2));
function k931(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) ** 2; } return b; }
p(931, k931(1.5), k931(0), k931(2));
function k932(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(e / 3); } return b; }
p(932, k932(1.5), k932(0), k932(2));
function k933(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) >>> 0; } return b; }
p(933, k933(1.5), k933(0), k933(2));
function k934(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e / 3) | 0; } return b; }
p(934, k934(1.5), k934(0), k934(2));
function k935(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(d); } return b; }
p(935, k935(1.5), k935(0), k935(2));
function k936(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(d); } return b; }
p(936, k936(1.5), k936(0), k936(2));
function k937(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(d); } return b; }
p(937, k937(1.5), k937(0), k937(2));
function k938(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) + 1; } return b; }
p(938, k938(1.5), k938(0), k938(2));
function k939(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) - 0.5; } return b; }
p(939, k939(1.5), k939(0), k939(2));
function k940(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) * 2; } return b; }
p(940, k940(1.5), k940(0), k940(2));
function k941(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) / 2; } return b; }
p(941, k941(1.5), k941(0), k941(2));
function k942(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) % 2; } return b; }
p(942, k942(1.5), k942(0), k942(2));
function k943(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) ** 2; } return b; }
p(943, k943(1.5), k943(0), k943(2));
function k944(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(d); } return b; }
p(944, k944(1.5), k944(0), k944(2));
function k945(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) >>> 0; } return b; }
p(945, k945(1.5), k945(0), k945(2));
function k946(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d) | 0; } return b; }
p(946, k946(1.5), k946(0), k946(2));
function k947(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(e); } return b; }
p(947, k947(1.5), k947(0), k947(2));
function k948(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(e); } return b; }
p(948, k948(1.5), k948(0), k948(2));
function k949(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(e); } return b; }
p(949, k949(1.5), k949(0), k949(2));
function k950(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) + 1; } return b; }
p(950, k950(1.5), k950(0), k950(2));
function k951(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) - 0.5; } return b; }
p(951, k951(1.5), k951(0), k951(2));
function k952(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) * 2; } return b; }
p(952, k952(1.5), k952(0), k952(2));
function k953(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) / 2; } return b; }
p(953, k953(1.5), k953(0), k953(2));
function k954(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) % 2; } return b; }
p(954, k954(1.5), k954(0), k954(2));
function k955(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) ** 2; } return b; }
p(955, k955(1.5), k955(0), k955(2));
function k956(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(e); } return b; }
p(956, k956(1.5), k956(0), k956(2));
function k957(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) >>> 0; } return b; }
p(957, k957(1.5), k957(0), k957(2));
function k958(y: number) { let e: number = -7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (e) | 0; } return b; }
p(958, k958(1.5), k958(0), k958(2));
function k959(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(i); } return b; }
p(959, k959(1.5), k959(0), k959(2));
function k960(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(i); } return b; }
p(960, k960(1.5), k960(0), k960(2));
function k961(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(i); } return b; }
p(961, k961(1.5), k961(0), k961(2));
function k962(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) + 1; } return b; }
p(962, k962(1.5), k962(0), k962(2));
function k963(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) - 0.5; } return b; }
p(963, k963(1.5), k963(0), k963(2));
function k964(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) * 2; } return b; }
p(964, k964(1.5), k964(0), k964(2));
function k965(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) / 2; } return b; }
p(965, k965(1.5), k965(0), k965(2));
function k966(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) % 2; } return b; }
p(966, k966(1.5), k966(0), k966(2));
function k967(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) ** 2; } return b; }
p(967, k967(1.5), k967(0), k967(2));
function k968(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(i); } return b; }
p(968, k968(1.5), k968(0), k968(2));
function k969(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) >>> 0; } return b; }
p(969, k969(1.5), k969(0), k969(2));
function k970(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i) | 0; } return b; }
p(970, k970(1.5), k970(0), k970(2));
function k971(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(i / 2); } return b; }
p(971, k971(1.5), k971(0), k971(2));
function k972(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(i / 2); } return b; }
p(972, k972(1.5), k972(0), k972(2));
function k973(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(i / 2); } return b; }
p(973, k973(1.5), k973(0), k973(2));
function k974(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) + 1; } return b; }
p(974, k974(1.5), k974(0), k974(2));
function k975(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) - 0.5; } return b; }
p(975, k975(1.5), k975(0), k975(2));
function k976(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) * 2; } return b; }
p(976, k976(1.5), k976(0), k976(2));
function k977(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) / 2; } return b; }
p(977, k977(1.5), k977(0), k977(2));
function k978(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) % 2; } return b; }
p(978, k978(1.5), k978(0), k978(2));
function k979(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) ** 2; } return b; }
p(979, k979(1.5), k979(0), k979(2));
function k980(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(i / 2); } return b; }
p(980, k980(1.5), k980(0), k980(2));
function k981(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) >>> 0; } return b; }
p(981, k981(1.5), k981(0), k981(2));
function k982(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i / 2) | 0; } return b; }
p(982, k982(1.5), k982(0), k982(2));
function k983(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(-i / 2); } return b; }
p(983, k983(1.5), k983(0), k983(2));
function k984(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(-i / 2); } return b; }
p(984, k984(1.5), k984(0), k984(2));
function k985(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(-i / 2); } return b; }
p(985, k985(1.5), k985(0), k985(2));
function k986(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) + 1; } return b; }
p(986, k986(1.5), k986(0), k986(2));
function k987(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) - 0.5; } return b; }
p(987, k987(1.5), k987(0), k987(2));
function k988(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) * 2; } return b; }
p(988, k988(1.5), k988(0), k988(2));
function k989(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) / 2; } return b; }
p(989, k989(1.5), k989(0), k989(2));
function k990(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) % 2; } return b; }
p(990, k990(1.5), k990(0), k990(2));
function k991(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) ** 2; } return b; }
p(991, k991(1.5), k991(0), k991(2));
function k992(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(-i / 2); } return b; }
p(992, k992(1.5), k992(0), k992(2));
function k993(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) >>> 0; } return b; }
p(993, k993(1.5), k993(0), k993(2));
function k994(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-i / 2) | 0; } return b; }
p(994, k994(1.5), k994(0), k994(2));
function k995(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(b); } return b; }
p(995, k995(1.5), k995(0), k995(2));
function k996(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(b); } return b; }
p(996, k996(1.5), k996(0), k996(2));
function k997(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(b); } return b; }
p(997, k997(1.5), k997(0), k997(2));
function k998(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) + 1; } return b; }
p(998, k998(1.5), k998(0), k998(2));
function k999(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) - 0.5; } return b; }
p(999, k999(1.5), k999(0), k999(2));
function k1000(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) * 2; } return b; }
p(1000, k1000(1.5), k1000(0), k1000(2));
function k1001(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) / 2; } return b; }
p(1001, k1001(1.5), k1001(0), k1001(2));
function k1002(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) % 2; } return b; }
p(1002, k1002(1.5), k1002(0), k1002(2));
function k1003(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) ** 2; } return b; }
p(1003, k1003(1.5), k1003(0), k1003(2));
function k1004(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(b); } return b; }
p(1004, k1004(1.5), k1004(0), k1004(2));
function k1005(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) >>> 0; } return b; }
p(1005, k1005(1.5), k1005(0), k1005(2));
function k1006(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (b) | 0; } return b; }
p(1006, k1006(1.5), k1006(0), k1006(2));
function k1007(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(y); } return b; }
p(1007, k1007(1.5), k1007(0), k1007(2));
function k1008(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(y); } return b; }
p(1008, k1008(1.5), k1008(0), k1008(2));
function k1009(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(y); } return b; }
p(1009, k1009(1.5), k1009(0), k1009(2));
function k1010(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) + 1; } return b; }
p(1010, k1010(1.5), k1010(0), k1010(2));
function k1011(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) - 0.5; } return b; }
p(1011, k1011(1.5), k1011(0), k1011(2));
function k1012(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) * 2; } return b; }
p(1012, k1012(1.5), k1012(0), k1012(2));
function k1013(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) / 2; } return b; }
p(1013, k1013(1.5), k1013(0), k1013(2));
function k1014(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) % 2; } return b; }
p(1014, k1014(1.5), k1014(0), k1014(2));
function k1015(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) ** 2; } return b; }
p(1015, k1015(1.5), k1015(0), k1015(2));
function k1016(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(y); } return b; }
p(1016, k1016(1.5), k1016(0), k1016(2));
function k1017(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) >>> 0; } return b; }
p(1017, k1017(1.5), k1017(0), k1017(2));
function k1018(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y) | 0; } return b; }
p(1018, k1018(1.5), k1018(0), k1018(2));
function k1019(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(y / 2); } return b; }
p(1019, k1019(1.5), k1019(0), k1019(2));
function k1020(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(y / 2); } return b; }
p(1020, k1020(1.5), k1020(0), k1020(2));
function k1021(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(y / 2); } return b; }
p(1021, k1021(1.5), k1021(0), k1021(2));
function k1022(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) + 1; } return b; }
p(1022, k1022(1.5), k1022(0), k1022(2));
function k1023(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) - 0.5; } return b; }
p(1023, k1023(1.5), k1023(0), k1023(2));
function k1024(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) * 2; } return b; }
p(1024, k1024(1.5), k1024(0), k1024(2));
function k1025(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) / 2; } return b; }
p(1025, k1025(1.5), k1025(0), k1025(2));
function k1026(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) % 2; } return b; }
p(1026, k1026(1.5), k1026(0), k1026(2));
function k1027(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) ** 2; } return b; }
p(1027, k1027(1.5), k1027(0), k1027(2));
function k1028(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(y / 2); } return b; }
p(1028, k1028(1.5), k1028(0), k1028(2));
function k1029(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) >>> 0; } return b; }
p(1029, k1029(1.5), k1029(0), k1029(2));
function k1030(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (y / 2) | 0; } return b; }
p(1030, k1030(1.5), k1030(0), k1030(2));
function k1031(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(0.5); } return b; }
p(1031, k1031(1.5), k1031(0), k1031(2));
function k1032(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(0.5); } return b; }
p(1032, k1032(1.5), k1032(0), k1032(2));
function k1033(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(0.5); } return b; }
p(1033, k1033(1.5), k1033(0), k1033(2));
function k1034(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) + 1; } return b; }
p(1034, k1034(1.5), k1034(0), k1034(2));
function k1035(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) - 0.5; } return b; }
p(1035, k1035(1.5), k1035(0), k1035(2));
function k1036(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) * 2; } return b; }
p(1036, k1036(1.5), k1036(0), k1036(2));
function k1037(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) / 2; } return b; }
p(1037, k1037(1.5), k1037(0), k1037(2));
function k1038(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) % 2; } return b; }
p(1038, k1038(1.5), k1038(0), k1038(2));
function k1039(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) ** 2; } return b; }
p(1039, k1039(1.5), k1039(0), k1039(2));
function k1040(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(0.5); } return b; }
p(1040, k1040(1.5), k1040(0), k1040(2));
function k1041(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) >>> 0; } return b; }
p(1041, k1041(1.5), k1041(0), k1041(2));
function k1042(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (0.5) | 0; } return b; }
p(1042, k1042(1.5), k1042(0), k1042(2));
function k1043(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(-0.5); } return b; }
p(1043, k1043(1.5), k1043(0), k1043(2));
function k1044(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(-0.5); } return b; }
p(1044, k1044(1.5), k1044(0), k1044(2));
function k1045(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(-0.5); } return b; }
p(1045, k1045(1.5), k1045(0), k1045(2));
function k1046(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) + 1; } return b; }
p(1046, k1046(1.5), k1046(0), k1046(2));
function k1047(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) - 0.5; } return b; }
p(1047, k1047(1.5), k1047(0), k1047(2));
function k1048(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) * 2; } return b; }
p(1048, k1048(1.5), k1048(0), k1048(2));
function k1049(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) / 2; } return b; }
p(1049, k1049(1.5), k1049(0), k1049(2));
function k1050(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) % 2; } return b; }
p(1050, k1050(1.5), k1050(0), k1050(2));
function k1051(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) ** 2; } return b; }
p(1051, k1051(1.5), k1051(0), k1051(2));
function k1052(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(-0.5); } return b; }
p(1052, k1052(1.5), k1052(0), k1052(2));
function k1053(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) >>> 0; } return b; }
p(1053, k1053(1.5), k1053(0), k1053(2));
function k1054(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0.5) | 0; } return b; }
p(1054, k1054(1.5), k1054(0), k1054(2));
function k1055(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(d * 0.5); } return b; }
p(1055, k1055(1.5), k1055(0), k1055(2));
function k1056(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(d * 0.5); } return b; }
p(1056, k1056(1.5), k1056(0), k1056(2));
function k1057(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(d * 0.5); } return b; }
p(1057, k1057(1.5), k1057(0), k1057(2));
function k1058(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) + 1; } return b; }
p(1058, k1058(1.5), k1058(0), k1058(2));
function k1059(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) - 0.5; } return b; }
p(1059, k1059(1.5), k1059(0), k1059(2));
function k1060(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) * 2; } return b; }
p(1060, k1060(1.5), k1060(0), k1060(2));
function k1061(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) / 2; } return b; }
p(1061, k1061(1.5), k1061(0), k1061(2));
function k1062(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) % 2; } return b; }
p(1062, k1062(1.5), k1062(0), k1062(2));
function k1063(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) ** 2; } return b; }
p(1063, k1063(1.5), k1063(0), k1063(2));
function k1064(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(d * 0.5); } return b; }
p(1064, k1064(1.5), k1064(0), k1064(2));
function k1065(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) >>> 0; } return b; }
p(1065, k1065(1.5), k1065(0), k1065(2));
function k1066(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d * 0.5) | 0; } return b; }
p(1066, k1066(1.5), k1066(0), k1066(2));
function k1067(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(NaN); } return b; }
p(1067, k1067(1.5), k1067(0), k1067(2));
function k1068(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(NaN); } return b; }
p(1068, k1068(1.5), k1068(0), k1068(2));
function k1069(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(NaN); } return b; }
p(1069, k1069(1.5), k1069(0), k1069(2));
function k1070(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) + 1; } return b; }
p(1070, k1070(1.5), k1070(0), k1070(2));
function k1071(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) - 0.5; } return b; }
p(1071, k1071(1.5), k1071(0), k1071(2));
function k1072(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) * 2; } return b; }
p(1072, k1072(1.5), k1072(0), k1072(2));
function k1073(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) / 2; } return b; }
p(1073, k1073(1.5), k1073(0), k1073(2));
function k1074(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) % 2; } return b; }
p(1074, k1074(1.5), k1074(0), k1074(2));
function k1075(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) ** 2; } return b; }
p(1075, k1075(1.5), k1075(0), k1075(2));
function k1076(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(NaN); } return b; }
p(1076, k1076(1.5), k1076(0), k1076(2));
function k1077(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) >>> 0; } return b; }
p(1077, k1077(1.5), k1077(0), k1077(2));
function k1078(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (NaN) | 0; } return b; }
p(1078, k1078(1.5), k1078(0), k1078(2));
function k1079(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(1e300); } return b; }
p(1079, k1079(1.5), k1079(0), k1079(2));
function k1080(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(1e300); } return b; }
p(1080, k1080(1.5), k1080(0), k1080(2));
function k1081(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(1e300); } return b; }
p(1081, k1081(1.5), k1081(0), k1081(2));
function k1082(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) + 1; } return b; }
p(1082, k1082(1.5), k1082(0), k1082(2));
function k1083(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) - 0.5; } return b; }
p(1083, k1083(1.5), k1083(0), k1083(2));
function k1084(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) * 2; } return b; }
p(1084, k1084(1.5), k1084(0), k1084(2));
function k1085(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) / 2; } return b; }
p(1085, k1085(1.5), k1085(0), k1085(2));
function k1086(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) % 2; } return b; }
p(1086, k1086(1.5), k1086(0), k1086(2));
function k1087(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) ** 2; } return b; }
p(1087, k1087(1.5), k1087(0), k1087(2));
function k1088(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(1e300); } return b; }
p(1088, k1088(1.5), k1088(0), k1088(2));
function k1089(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) >>> 0; } return b; }
p(1089, k1089(1.5), k1089(0), k1089(2));
function k1090(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (1e300) | 0; } return b; }
p(1090, k1090(1.5), k1090(0), k1090(2));
function k1091(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(-0); } return b; }
p(1091, k1091(1.5), k1091(0), k1091(2));
function k1092(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(-0); } return b; }
p(1092, k1092(1.5), k1092(0), k1092(2));
function k1093(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(-0); } return b; }
p(1093, k1093(1.5), k1093(0), k1093(2));
function k1094(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) + 1; } return b; }
p(1094, k1094(1.5), k1094(0), k1094(2));
function k1095(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) - 0.5; } return b; }
p(1095, k1095(1.5), k1095(0), k1095(2));
function k1096(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) * 2; } return b; }
p(1096, k1096(1.5), k1096(0), k1096(2));
function k1097(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) / 2; } return b; }
p(1097, k1097(1.5), k1097(0), k1097(2));
function k1098(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) % 2; } return b; }
p(1098, k1098(1.5), k1098(0), k1098(2));
function k1099(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) ** 2; } return b; }
p(1099, k1099(1.5), k1099(0), k1099(2));
function k1100(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(-0); } return b; }
p(1100, k1100(1.5), k1100(0), k1100(2));
function k1101(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) >>> 0; } return b; }
p(1101, k1101(1.5), k1101(0), k1101(2));
function k1102(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-0) | 0; } return b; }
p(1102, k1102(1.5), k1102(0), k1102(2));
function k1103(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(d % 3); } return b; }
p(1103, k1103(1.5), k1103(0), k1103(2));
function k1104(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(d % 3); } return b; }
p(1104, k1104(1.5), k1104(0), k1104(2));
function k1105(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(d % 3); } return b; }
p(1105, k1105(1.5), k1105(0), k1105(2));
function k1106(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) + 1; } return b; }
p(1106, k1106(1.5), k1106(0), k1106(2));
function k1107(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) - 0.5; } return b; }
p(1107, k1107(1.5), k1107(0), k1107(2));
function k1108(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) * 2; } return b; }
p(1108, k1108(1.5), k1108(0), k1108(2));
function k1109(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) / 2; } return b; }
p(1109, k1109(1.5), k1109(0), k1109(2));
function k1110(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) % 2; } return b; }
p(1110, k1110(1.5), k1110(0), k1110(2));
function k1111(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) ** 2; } return b; }
p(1111, k1111(1.5), k1111(0), k1111(2));
function k1112(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(d % 3); } return b; }
p(1112, k1112(1.5), k1112(0), k1112(2));
function k1113(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) >>> 0; } return b; }
p(1113, k1113(1.5), k1113(0), k1113(2));
function k1114(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d % 3) | 0; } return b; }
p(1114, k1114(1.5), k1114(0), k1114(2));
function k1115(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(i - 2); } return b; }
p(1115, k1115(1.5), k1115(0), k1115(2));
function k1116(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(i - 2); } return b; }
p(1116, k1116(1.5), k1116(0), k1116(2));
function k1117(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(i - 2); } return b; }
p(1117, k1117(1.5), k1117(0), k1117(2));
function k1118(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) + 1; } return b; }
p(1118, k1118(1.5), k1118(0), k1118(2));
function k1119(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) - 0.5; } return b; }
p(1119, k1119(1.5), k1119(0), k1119(2));
function k1120(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) * 2; } return b; }
p(1120, k1120(1.5), k1120(0), k1120(2));
function k1121(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) / 2; } return b; }
p(1121, k1121(1.5), k1121(0), k1121(2));
function k1122(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) % 2; } return b; }
p(1122, k1122(1.5), k1122(0), k1122(2));
function k1123(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) ** 2; } return b; }
p(1123, k1123(1.5), k1123(0), k1123(2));
function k1124(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(i - 2); } return b; }
p(1124, k1124(1.5), k1124(0), k1124(2));
function k1125(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) >>> 0; } return b; }
p(1125, k1125(1.5), k1125(0), k1125(2));
function k1126(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (i - 2) | 0; } return b; }
p(1126, k1126(1.5), k1126(0), k1126(2));
function k1127(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(d / 3 + i); } return b; }
p(1127, k1127(1.5), k1127(0), k1127(2));
function k1128(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(d / 3 + i); } return b; }
p(1128, k1128(1.5), k1128(0), k1128(2));
function k1129(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(d / 3 + i); } return b; }
p(1129, k1129(1.5), k1129(0), k1129(2));
function k1130(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) + 1; } return b; }
p(1130, k1130(1.5), k1130(0), k1130(2));
function k1131(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) - 0.5; } return b; }
p(1131, k1131(1.5), k1131(0), k1131(2));
function k1132(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) * 2; } return b; }
p(1132, k1132(1.5), k1132(0), k1132(2));
function k1133(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) / 2; } return b; }
p(1133, k1133(1.5), k1133(0), k1133(2));
function k1134(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) % 2; } return b; }
p(1134, k1134(1.5), k1134(0), k1134(2));
function k1135(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) ** 2; } return b; }
p(1135, k1135(1.5), k1135(0), k1135(2));
function k1136(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(d / 3 + i); } return b; }
p(1136, k1136(1.5), k1136(0), k1136(2));
function k1137(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) >>> 0; } return b; }
p(1137, k1137(1.5), k1137(0), k1137(2));
function k1138(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3 + i) | 0; } return b; }
p(1138, k1138(1.5), k1138(0), k1138(2));
function k1139(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number((d / 3) | 0); } return b; }
p(1139, k1139(1.5), k1139(0), k1139(2));
function k1140(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +((d / 3) | 0); } return b; }
p(1140, k1140(1.5), k1140(0), k1140(2));
function k1141(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -((d / 3) | 0); } return b; }
p(1141, k1141(1.5), k1141(0), k1141(2));
function k1142(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) + 1; } return b; }
p(1142, k1142(1.5), k1142(0), k1142(2));
function k1143(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) - 0.5; } return b; }
p(1143, k1143(1.5), k1143(0), k1143(2));
function k1144(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) * 2; } return b; }
p(1144, k1144(1.5), k1144(0), k1144(2));
function k1145(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) / 2; } return b; }
p(1145, k1145(1.5), k1145(0), k1145(2));
function k1146(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) % 2; } return b; }
p(1146, k1146(1.5), k1146(0), k1146(2));
function k1147(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) ** 2; } return b; }
p(1147, k1147(1.5), k1147(0), k1147(2));
function k1148(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~((d / 3) | 0); } return b; }
p(1148, k1148(1.5), k1148(0), k1148(2));
function k1149(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) >>> 0; } return b; }
p(1149, k1149(1.5), k1149(0), k1149(2));
function k1150(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ((d / 3) | 0) | 0; } return b; }
p(1150, k1150(1.5), k1150(0), k1150(2));
function k1151(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(2.5 - d / 2); } return b; }
p(1151, k1151(1.5), k1151(0), k1151(2));
function k1152(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(2.5 - d / 2); } return b; }
p(1152, k1152(1.5), k1152(0), k1152(2));
function k1153(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(2.5 - d / 2); } return b; }
p(1153, k1153(1.5), k1153(0), k1153(2));
function k1154(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) + 1; } return b; }
p(1154, k1154(1.5), k1154(0), k1154(2));
function k1155(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) - 0.5; } return b; }
p(1155, k1155(1.5), k1155(0), k1155(2));
function k1156(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) * 2; } return b; }
p(1156, k1156(1.5), k1156(0), k1156(2));
function k1157(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) / 2; } return b; }
p(1157, k1157(1.5), k1157(0), k1157(2));
function k1158(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) % 2; } return b; }
p(1158, k1158(1.5), k1158(0), k1158(2));
function k1159(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) ** 2; } return b; }
p(1159, k1159(1.5), k1159(0), k1159(2));
function k1160(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(2.5 - d / 2); } return b; }
p(1160, k1160(1.5), k1160(0), k1160(2));
function k1161(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) >>> 0; } return b; }
p(1161, k1161(1.5), k1161(0), k1161(2));
function k1162(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (2.5 - d / 2) | 0; } return b; }
p(1162, k1162(1.5), k1162(0), k1162(2));
function k1163(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(Infinity); } return b; }
p(1163, k1163(1.5), k1163(0), k1163(2));
function k1164(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(Infinity); } return b; }
p(1164, k1164(1.5), k1164(0), k1164(2));
function k1165(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(Infinity); } return b; }
p(1165, k1165(1.5), k1165(0), k1165(2));
function k1166(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) + 1; } return b; }
p(1166, k1166(1.5), k1166(0), k1166(2));
function k1167(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) - 0.5; } return b; }
p(1167, k1167(1.5), k1167(0), k1167(2));
function k1168(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) * 2; } return b; }
p(1168, k1168(1.5), k1168(0), k1168(2));
function k1169(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) / 2; } return b; }
p(1169, k1169(1.5), k1169(0), k1169(2));
function k1170(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) % 2; } return b; }
p(1170, k1170(1.5), k1170(0), k1170(2));
function k1171(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) ** 2; } return b; }
p(1171, k1171(1.5), k1171(0), k1171(2));
function k1172(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(Infinity); } return b; }
p(1172, k1172(1.5), k1172(0), k1172(2));
function k1173(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) >>> 0; } return b; }
p(1173, k1173(1.5), k1173(0), k1173(2));
function k1174(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (Infinity) | 0; } return b; }
p(1174, k1174(1.5), k1174(0), k1174(2));
function k1175(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number(-d / 7); } return b; }
p(1175, k1175(1.5), k1175(0), k1175(2));
function k1176(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = +(-d / 7); } return b; }
p(1176, k1176(1.5), k1176(0), k1176(2));
function k1177(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = -(-d / 7); } return b; }
p(1177, k1177(1.5), k1177(0), k1177(2));
function k1178(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) + 1; } return b; }
p(1178, k1178(1.5), k1178(0), k1178(2));
function k1179(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) - 0.5; } return b; }
p(1179, k1179(1.5), k1179(0), k1179(2));
function k1180(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) * 2; } return b; }
p(1180, k1180(1.5), k1180(0), k1180(2));
function k1181(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) / 2; } return b; }
p(1181, k1181(1.5), k1181(0), k1181(2));
function k1182(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) % 2; } return b; }
p(1182, k1182(1.5), k1182(0), k1182(2));
function k1183(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) ** 2; } return b; }
p(1183, k1183(1.5), k1183(0), k1183(2));
function k1184(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = ~(-d / 7); } return b; }
p(1184, k1184(1.5), k1184(0), k1184(2));
function k1185(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) >>> 0; } return b; }
p(1185, k1185(1.5), k1185(0), k1185(2));
function k1186(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = (-d / 7) | 0; } return b; }
p(1186, k1186(1.5), k1186(0), k1186(2));
