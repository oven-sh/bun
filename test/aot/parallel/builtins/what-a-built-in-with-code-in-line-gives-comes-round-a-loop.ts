// Each built-in that has code in line, in a counted loop, with operands that fold to a fraction among them. What it gives comes round the loop.
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
function plus(x: number) { return x + 1; }
class Box { x: number; constructor(x: number) { this.x = x; } }

function k1(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = parseInt('12px'); } return b; }
p(1, k1(1.5), k1(0), k1(2));
function k2(y: number) { let d: number = 7; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = parseInt(String(d / 3)); } return b; }
p(2, k2(1.5), k2(0), k2(2));
function k3(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = parseFloat('2.5'); } return b; }
p(3, k3(1.5), k3(0), k3(2));
function k4(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number('2.5'); } return b; }
p(4, k4(1.5), k4(0), k4(2));
function k5(y: number) { let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Number.parseFloat('0.25'); } return b; }
p(5, k5(1.5), k5(0), k5(2));
function k6(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.length; } return b; }
p(6, k6(1.5), k6(0), k6(2));
function k7(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.charCodeAt(i); } return b; }
p(7, k7(1.5), k7(0), k7(2));
function k8(y: number) { let d: number = 7, s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.charCodeAt(d / 3); } return b; }
p(8, k8(1.5), k8(0), k8(2));
function k9(y: number) { let e: number = -7, s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.charCodeAt(e); } return b; }
p(9, k9(1.5), k9(0), k9(2));
function k10(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.codePointAt(i) ?? -1; } return b; }
p(10, k10(1.5), k10(0), k10(2));
function k11(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.indexOf('l'); } return b; }
p(11, k11(1.5), k11(0), k11(2));
function k12(y: number) { let d: number = 7, s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.indexOf('l', d / 3); } return b; }
p(12, k12(1.5), k12(0), k12(2));
function k13(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.lastIndexOf('l'); } return b; }
p(13, k13(1.5), k13(0), k13(2));
function k14(y: number) { let d: number = 7, s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.lastIndexOf('l', d / 3); } return b; }
p(14, k14(1.5), k14(0), k14(2));
function k15(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.search(/l/); } return b; }
p(15, k15(1.5), k15(0), k15(2));
function k16(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = s.localeCompare('h'); } return b; }
p(16, k16(1.5), k16(0), k16(2));
function k17(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.length; } return b; }
p(17, k17(1.5), k17(0), k17(2));
function k18(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.indexOf(2.5); } return b; }
p(18, k18(1.5), k18(0), k18(2));
function k19(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.indexOf(d / 2); } return b; }
p(19, k19(1.5), k19(0), k19(2));
function k20(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.push(d / 3); } return b; }
p(20, k20(1.5), k20(0), k20(2));
function k21(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.unshift(d / 3); } return b; }
p(21, k21(1.5), k21(0), k21(2));
function k22(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.at(i) ?? -1; } return b; }
p(22, k22(1.5), k22(0), k22(2));
function k23(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.at(d / 3) ?? -1; } return b; }
p(23, k23(1.5), k23(0), k23(2));
function k24(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.at(-1) ?? -1; } return b; }
p(24, k24(1.5), k24(0), k24(2));
function k25(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.pop() ?? -1; } return b; }
p(25, k25(1.5), k25(0), k25(2));
function k26(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = a.shift() ?? -1; } return b; }
p(26, k26(1.5), k26(0), k26(2));
function k27(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max(...a); } return b; }
p(27, k27(1.5), k27(0), k27(2));
function k28(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.min(...a); } return b; }
p(28, k28(1.5), k28(0), k28(2));
function k29(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Math.max.apply(null, a); } return b; }
p(29, k29(1.5), k29(0), k29(2));
function k30(y: number) { let u = new Uint8Array([1, 2, 3, 4]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = u.length; } return b; }
p(30, k30(1.5), k30(0), k30(2));
function k31(y: number) { let u = new Uint8Array([1, 2, 3, 4]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = u.byteLength; } return b; }
p(31, k31(1.5), k31(0), k31(2));
function k32(y: number) { let u = new Uint8Array([1, 2, 3, 4]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = u.byteOffset; } return b; }
p(32, k32(1.5), k32(0), k32(2));
function k33(y: number) { let u = new Uint8Array([1, 2, 3, 4]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = u[i] ?? -1; } return b; }
p(33, k33(1.5), k33(0), k33(2));
function k34(y: number) { let f64 = new Float64Array([7, 2.5]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = f64[i] ?? -1; } return b; }
p(34, k34(1.5), k34(0), k34(2));
function k35(y: number) { let f64 = new Float64Array([7, 2.5]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = f64[0] / 3; } return b; }
p(35, k35(1.5), k35(0), k35(2));
function k36(y: number) { let u = new Uint8Array([1, 2, 3, 4]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = u.at(i) ?? -1; } return b; }
p(36, k36(1.5), k36(0), k36(2));
function k37(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = m.size; } return b; }
p(37, k37(1.5), k37(0), k37(2));
function k38(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = m.get(1) ?? -1; } return b; }
p(38, k38(1.5), k38(0), k38(2));
function k39(y: number) { let d: number = 7, m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = m.get(d / 2) ?? -1; } return b; }
p(39, k39(1.5), k39(0), k39(2));
function k40(y: number) { let st = new Set<number>([1, 3.5]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = st.size; } return b; }
p(40, k40(1.5), k40(0), k40(2));
function k41(y: number) { let buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = view.getFloat64(0); } return b; }
p(41, k41(1.5), k41(0), k41(2));
function k42(y: number) { let buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = view.getInt8(i); } return b; }
p(42, k42(1.5), k42(0), k42(2));
function k43(y: number) { let buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = view.getUint32(0); } return b; }
p(43, k43(1.5), k43(0), k43(2));
function k44(y: number) { let buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = view.byteLength; } return b; }
p(44, k44(1.5), k44(0), k44(2));
function k45(y: number) { let buffer = new ArrayBuffer(16); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = buffer.byteLength; } return b; }
p(45, k45(1.5), k45(0), k45(2));
function k46(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getTime(); } return b; }
p(46, k46(1.5), k46(0), k46(2));
function k47(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCFullYear(); } return b; }
p(47, k47(1.5), k47(0), k47(2));
function k48(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCMonth(); } return b; }
p(48, k48(1.5), k48(0), k48(2));
function k49(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCDate(); } return b; }
p(49, k49(1.5), k49(0), k49(2));
function k50(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCDay(); } return b; }
p(50, k50(1.5), k50(0), k50(2));
function k51(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCHours(); } return b; }
p(51, k51(1.5), k51(0), k51(2));
function k52(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCMinutes(); } return b; }
p(52, k52(1.5), k52(0), k52(2));
function k53(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCSeconds(); } return b; }
p(53, k53(1.5), k53(0), k53(2));
function k54(y: number) { let date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.getUTCMilliseconds(); } return b; }
p(54, k54(1.5), k54(0), k54(2));
function k55(y: number) { let d: number = 7, date = new Date(86400000.5 * 400); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = date.setTime(d / 3); } return b; }
p(55, k55(1.5), k55(0), k55(2));
function k56(y: number) { let re = /l+/g; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = re.lastIndex; } return b; }
p(56, k56(1.5), k56(0), k56(2));
function k57(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.load(i32, 0); } return b; }
p(57, k57(1.5), k57(0), k57(2));
function k58(y: number) { let d: number = 7, i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.add(i32, 0, d / 3); } return b; }
p(58, k58(1.5), k58(0), k58(2));
function k59(y: number) { let d: number = 7, i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.store(i32, 0, d / 3); } return b; }
p(59, k59(1.5), k59(0), k59(2));
function k60(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.exchange(i32, 0, 2); } return b; }
p(60, k60(1.5), k60(0), k60(2));
function k61(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.compareExchange(i32, 0, 2, 3); } return b; }
p(61, k61(1.5), k61(0), k61(2));
function k62(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.or(i32, 0, 1); } return b; }
p(62, k62(1.5), k62(0), k62(2));
function k63(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.and(i32, 0, 3); } return b; }
p(63, k63(1.5), k63(0), k63(2));
function k64(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.sub(i32, 0, 1); } return b; }
p(64, k64(1.5), k64(0), k64(2));
function k65(y: number) { let i32 = new Int32Array(new SharedArrayBuffer(8)); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Atomics.xor(i32, 0, 1); } return b; }
p(65, k65(1.5), k65(0), k65(2));
function k66(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.readUInt8(i); } return b; }
p(66, k66(1.5), k66(0), k66(2));
function k67(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.readInt16LE(0); } return b; }
p(67, k67(1.5), k67(0), k67(2));
function k68(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.readDoubleLE(0); } return b; }
p(68, k68(1.5), k68(0), k68(2));
function k69(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.readFloatBE(0); } return b; }
p(69, k69(1.5), k69(0), k69(2));
function k70(y: number) { let d: number = 7, node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.writeUInt8(d, 0); } return b; }
p(70, k70(1.5), k70(0), k70(2));
function k71(y: number) { let d: number = 7, node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.writeDoubleLE(d / 3, 0); } return b; }
p(71, k71(1.5), k71(0), k71(2));
function k72(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = node.length; } return b; }
p(72, k72(1.5), k72(0), k72(2));
function k73(y: number) { let s: string = "hello world"; let b: number = 0, i = 0; while (i < (y & 3) + 1) { i++; b = Buffer.byteLength(s); } return b; }
p(73, k73(1.5), k73(0), k73(2));
function k74(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = isNaN(d / 3); } return b; }
p(74, k74(1.5), k74(0), k74(2));
function k75(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = isFinite(d / 3); } return b; }
p(75, k75(1.5), k75(0), k75(2));
function k76(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Number.isNaN(d / 3); } return b; }
p(76, k76(1.5), k76(0), k76(2));
function k77(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Number.isFinite(d / 3); } return b; }
p(77, k77(1.5), k77(0), k77(2));
function k78(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Number.isInteger(d / 3); } return b; }
p(78, k78(1.5), k78(0), k78(2));
function k79(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Number.isInteger(i); } return b; }
p(79, k79(1.5), k79(0), k79(2));
function k80(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Number.isSafeInteger(d / 3); } return b; }
p(80, k80(1.5), k80(0), k80(2));
function k81(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Number.isSafeInteger(b); } return b; }
p(81, k81(1.5), k81(0), k81(2));
function k82(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.is(d / 3, b); } return b; }
p(82, k82(1.5), k82(0), k82(2));
function k83(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.is(-0, 0); } return b; }
p(83, k83(1.5), k83(0), k83(2));
function k84(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3).toString(); } return b; }
p(84, k84(1.5), k84(0), k84(2));
function k85(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (d / 3).toFixed(2); } return b; }
p(85, k85(1.5), k85(0), k85(2));
function k86(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (i).toString(2); } return b; }
p(86, k86(1.5), k86(0), k86(2));
function k87(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = String(d / 3); } return b; }
p(87, k87(1.5), k87(0), k87(2));
function k88(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = String(i); } return b; }
p(88, k88(1.5), k88(0), k88(2));
function k89(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = `${d / 3}`; } return b; }
p(89, k89(1.5), k89(0), k89(2));
function k90(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = '' + d / 3; } return b; }
p(90, k90(1.5), k90(0), k90(2));
function k91(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.at(i); } return b; }
p(91, k91(1.5), k91(0), k91(2));
function k92(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.at(d / 3); } return b; }
p(92, k92(1.5), k92(0), k92(2));
function k93(y: number) { let e: number = -7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.at(e); } return b; }
p(93, k93(1.5), k93(0), k93(2));
function k94(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.charAt(i); } return b; }
p(94, k94(1.5), k94(0), k94(2));
function k95(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.charAt(d / 3); } return b; }
p(95, k95(1.5), k95(0), k95(2));
function k96(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.slice(i); } return b; }
p(96, k96(1.5), k96(0), k96(2));
function k97(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.slice(d / 3); } return b; }
p(97, k97(1.5), k97(0), k97(2));
function k98(y: number) { let e: number = -7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.slice(e / 3); } return b; }
p(98, k98(1.5), k98(0), k98(2));
function k99(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.slice(1, d / 3); } return b; }
p(99, k99(1.5), k99(0), k99(2));
function k100(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.substring(i); } return b; }
p(100, k100(1.5), k100(0), k100(2));
function k101(y: number) { let d: number = 7, e: number = -7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.substring(d / 3, e); } return b; }
p(101, k101(1.5), k101(0), k101(2));
function k102(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.substr(i, 2); } return b; }
p(102, k102(1.5), k102(0), k102(2));
function k103(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.substr(d / 3); } return b; }
p(103, k103(1.5), k103(0), k103(2));
function k104(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.startsWith('h'); } return b; }
p(104, k104(1.5), k104(0), k104(2));
function k105(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.startsWith('e', d / 7); } return b; }
p(105, k105(1.5), k105(0), k105(2));
function k106(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.endsWith('d'); } return b; }
p(106, k106(1.5), k106(0), k106(2));
function k107(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.includes('l'); } return b; }
p(107, k107(1.5), k107(0), k107(2));
function k108(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.includes('l', d / 3); } return b; }
p(108, k108(1.5), k108(0), k108(2));
function k109(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.toLowerCase(); } return b; }
p(109, k109(1.5), k109(0), k109(2));
function k110(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.toUpperCase(); } return b; }
p(110, k110(1.5), k110(0), k110(2));
function k111(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.trim(); } return b; }
p(111, k111(1.5), k111(0), k111(2));
function k112(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.trimStart(); } return b; }
p(112, k112(1.5), k112(0), k112(2));
function k113(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.trimEnd(); } return b; }
p(113, k113(1.5), k113(0), k113(2));
function k114(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.concat('x'); } return b; }
p(114, k114(1.5), k114(0), k114(2));
function k115(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.concat(d / 3); } return b; }
p(115, k115(1.5), k115(0), k115(2));
function k116(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = String.fromCharCode(65 + i); } return b; }
p(116, k116(1.5), k116(0), k116(2));
function k117(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = String.fromCharCode(65.5); } return b; }
p(117, k117(1.5), k117(0), k117(2));
function k118(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = String.fromCharCode(d / 3 + 64); } return b; }
p(118, k118(1.5), k118(0), k118(2));
function k119(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = String.fromCodePoint(65 + i); } return b; }
p(119, k119(1.5), k119(0), k119(2));
function k120(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.repeat(i); } return b; }
p(120, k120(1.5), k120(0), k120(2));
function k121(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.repeat(d / 3); } return b; }
p(121, k121(1.5), k121(0), k121(2));
function k122(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.padStart(d * 2); } return b; }
p(122, k122(1.5), k122(0), k122(2));
function k123(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.padEnd(d * 2.5, '.'); } return b; }
p(123, k123(1.5), k123(0), k123(2));
function k124(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.isWellFormed(); } return b; }
p(124, k124(1.5), k124(0), k124(2));
function k125(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.toWellFormed(); } return b; }
p(125, k125(1.5), k125(0), k125(2));
function k126(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.normalize(); } return b; }
p(126, k126(1.5), k126(0), k126(2));
function k127(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.split('l'); } return b; }
p(127, k127(1.5), k127(0), k127(2));
function k128(y: number) { let d: number = 7, s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.split('l', d / 3); } return b; }
p(128, k128(1.5), k128(0), k128(2));
function k129(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.split(/l/); } return b; }
p(129, k129(1.5), k129(0), k129(2));
function k130(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.replace('l', 'L'); } return b; }
p(130, k130(1.5), k130(0), k130(2));
function k131(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.replace(/l/, 'L'); } return b; }
p(131, k131(1.5), k131(0), k131(2));
function k132(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.replaceAll('l', 'L'); } return b; }
p(132, k132(1.5), k132(0), k132(2));
function k133(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.replaceAll(/l/g, 'L'); } return b; }
p(133, k133(1.5), k133(0), k133(2));
function k134(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.match(/l+/); } return b; }
p(134, k134(1.5), k134(0), k134(2));
function k135(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = s.match(/z/); } return b; }
p(135, k135(1.5), k135(0), k135(2));
function k136(y: number) { let s: string = "hello world", re = /l+/g; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = re.exec(s); } return b; }
p(136, k136(1.5), k136(0), k136(2));
function k137(y: number) { let s: string = "hello world", re = /l+/g; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = re.test(s); } return b; }
p(137, k137(1.5), k137(0), k137(2));
function k138(y: number) { let re = /l+/g; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = re.flags; } return b; }
p(138, k138(1.5), k138(0), k138(2));
function k139(y: number) { let re = /l+/g; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = re.source; } return b; }
p(139, k139(1.5), k139(0), k139(2));
function k140(y: number) { let re = /l+/g; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = re.global; } return b; }
p(140, k140(1.5), k140(0), k140(2));
function k141(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new RegExp('a' + i); } return b; }
p(141, k141(1.5), k141(0), k141(2));
function k142(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.includes(2.5); } return b; }
p(142, k142(1.5), k142(0), k142(2));
function k143(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.includes(d / 2); } return b; }
p(143, k143(1.5), k143(0), k143(2));
function k144(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.join(); } return b; }
p(144, k144(1.5), k144(0), k144(2));
function k145(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.join('-'); } return b; }
p(145, k145(1.5), k145(0), k145(2));
function k146(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.concat([d / 3]); } return b; }
p(146, k146(1.5), k146(0), k146(2));
function k147(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.slice(i); } return b; }
p(147, k147(1.5), k147(0), k147(2));
function k148(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.slice(d / 3); } return b; }
p(148, k148(1.5), k148(0), k148(2));
function k149(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.splice(0, 1); } return b; }
p(149, k149(1.5), k149(0), k149(2));
function k150(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.splice(d / 3); } return b; }
p(150, k150(1.5), k150(0), k150(2));
function k151(y: number) { let d: number = 7, a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.with(0, d / 3); } return b; }
p(151, k151(1.5), k151(0), k151(2));
function k152(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.toReversed(); } return b; }
p(152, k152(1.5), k152(0), k152(2));
function k153(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = a.toSpliced(0, 1); } return b; }
p(153, k153(1.5), k153(0), k153(2));
function k154(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Array.isArray(a); } return b; }
p(154, k154(1.5), k154(0), k154(2));
function k155(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Array.isArray(b); } return b; }
p(155, k155(1.5), k155(0), k155(2));
function k156(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Array(i); } return b; }
p(156, k156(1.5), k156(0), k156(2));
function k157(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Array(3); } return b; }
p(157, k157(1.5), k157(0), k157(2));
function k158(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Array.of(d / 3, i); } return b; }
p(158, k158(1.5), k158(0), k158(2));
function k159(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Array.from(a); } return b; }
p(159, k159(1.5), k159(0), k159(2));
function k160(y: number) { let s: string = "hello world"; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Array.from(s); } return b; }
p(160, k160(1.5), k160(0), k160(2));
function k161(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...a.keys()]; } return b; }
p(161, k161(1.5), k161(0), k161(2));
function k162(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...a.values()]; } return b; }
p(162, k162(1.5), k162(0), k162(2));
function k163(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...a.entries()]; } return b; }
p(163, k163(1.5), k163(0), k163(2));
function k164(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [d / 3, i]; } return b; }
p(164, k164(1.5), k164(0), k164(2));
function k165(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Uint8Array(i); } return b; }
p(165, k165(1.5), k165(0), k165(2));
function k166(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Float64Array(2); } return b; }
p(166, k166(1.5), k166(0), k166(2));
function k167(y: number) { let u = new Uint8Array([1, 2, 3, 4]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (u.set([1]), u); } return b; }
p(167, k167(1.5), k167(0), k167(2));
function k168(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.keys(o); } return b; }
p(168, k168(1.5), k168(0), k168(2));
function k169(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.getOwnPropertyNames(o); } return b; }
p(169, k169(1.5), k169(0), k169(2));
function k170(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.getOwnPropertySymbols(o); } return b; }
p(170, k170(1.5), k170(0), k170(2));
function k171(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Reflect.ownKeys(o); } return b; }
p(171, k171(1.5), k171(0), k171(2));
function k172(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.getOwnPropertyDescriptor(o, 'x'); } return b; }
p(172, k172(1.5), k172(0), k172(2));
function k173(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.hasOwn(o, 'x'); } return b; }
p(173, k173(1.5), k173(0), k173(2));
function k174(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = o.hasOwnProperty('x'); } return b; }
p(174, k174(1.5), k174(0), k174(2));
function k175(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = o.propertyIsEnumerable('x'); } return b; }
p(175, k175(1.5), k175(0), k175(2));
function k176(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.values(o); } return b; }
p(176, k176(1.5), k176(0), k176(2));
function k177(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.entries(o); } return b; }
p(177, k177(1.5), k177(0), k177(2));
function k178(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.create(null); } return b; }
p(178, k178(1.5), k178(0), k178(2));
function k179(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.create(o); } return b; }
p(179, k179(1.5), k179(0), k179(2));
function k180(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.getPrototypeOf(o) === Object.prototype; } return b; }
p(180, k180(1.5), k180(0), k180(2));
function k181(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Reflect.getPrototypeOf(o) === Object.prototype; } return b; }
p(181, k181(1.5), k181(0), k181(2));
function k182(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.setPrototypeOf({}, o); } return b; }
p(182, k182(1.5), k182(0), k182(2));
function k183(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Reflect.setPrototypeOf({}, o); } return b; }
p(183, k183(1.5), k183(0), k183(2));
function k184(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object(d / 3); } return b; }
p(184, k184(1.5), k184(0), k184(2));
function k185(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object(o); } return b; }
p(185, k185(1.5), k185(0), k185(2));
function k186(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.freeze({ x: d / 3 }); } return b; }
p(186, k186(1.5), k186(0), k186(2));
function k187(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.prototype.toString.call(d / 3); } return b; }
p(187, k187(1.5), k187(0), k187(2));
function k188(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = o.toString(); } return b; }
p(188, k188(1.5), k188(0), k188(2));
function k189(y: number) { let o: any = { x: 1, z: 2.5 }; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Object.assign({}, o); } return b; }
p(189, k189(1.5), k189(0), k189(2));
function k190(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Map(); } return b; }
p(190, k190(1.5), k190(0), k190(2));
function k191(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Set(); } return b; }
p(191, k191(1.5), k191(0), k191(2));
function k192(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = m.has(1); } return b; }
p(192, k192(1.5), k192(0), k192(2));
function k193(y: number) { let d: number = 7, m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = m.has(d / 2); } return b; }
p(193, k193(1.5), k193(0), k193(2));
function k194(y: number) { let d: number = 7, st = new Set<number>([1, 3.5]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = st.has(d / 2); } return b; }
p(194, k194(1.5), k194(0), k194(2));
function k195(y: number) { let d: number = 7, m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = m.set(d / 3, i); } return b; }
p(195, k195(1.5), k195(0), k195(2));
function k196(y: number) { let d: number = 7, st = new Set<number>([1, 3.5]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = st.add(d / 3); } return b; }
p(196, k196(1.5), k196(0), k196(2));
function k197(y: number) { let a: number[] = [1, 2.5, 3.5]; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Set(a); } return b; }
p(197, k197(1.5), k197(0), k197(2));
function k198(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Map([[d / 3, i]]); } return b; }
p(198, k198(1.5), k198(0), k198(2));
function k199(y: number) { let o: any = { x: 1, z: 2.5 }, wm = new WeakMap([[o, 1]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = wm.get(o); } return b; }
p(199, k199(1.5), k199(0), k199(2));
function k200(y: number) { let o: any = { x: 1, z: 2.5 }, wm = new WeakMap([[o, 1]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = wm.has(o); } return b; }
p(200, k200(1.5), k200(0), k200(2));
function k201(y: number) { let o: any = { x: 1, z: 2.5 }, ws = new WeakSet([o]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = ws.has(o); } return b; }
p(201, k201(1.5), k201(0), k201(2));
function k202(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = m.delete(1); } return b; }
p(202, k202(1.5), k202(0), k202(2));
function k203(y: number) { let st = new Set<number>([1, 3.5]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = st.delete(1); } return b; }
p(203, k203(1.5), k203(0), k203(2));
function k204(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (m.clear(), m.size); } return b; }
p(204, k204(1.5), k204(0), k204(2));
function k205(y: number) { let st = new Set<number>([1, 3.5]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (st.clear(), st.size); } return b; }
p(205, k205(1.5), k205(0), k205(2));
function k206(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...m.keys()]; } return b; }
p(206, k206(1.5), k206(0), k206(2));
function k207(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...m.values()]; } return b; }
p(207, k207(1.5), k207(0), k207(2));
function k208(y: number) { let m = new Map<number, number>([[1, 2], [3.5, 4.5]]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...m.entries()]; } return b; }
p(208, k208(1.5), k208(0), k208(2));
function k209(y: number) { let st = new Set<number>([1, 3.5]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = [...st.values()]; } return b; }
p(209, k209(1.5), k209(0), k209(2));
function k210(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof Promise.resolve(d / 3); } return b; }
p(210, k210(1.5), k210(0), k210(2));
function k211(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof Promise.resolve(1).then(() => 2); } return b; }
p(211, k211(1.5), k211(0), k211(2));
function k212(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof Promise.reject(1).catch(() => 2); } return b; }
p(212, k212(1.5), k212(0), k212(2));
function k213(y: number) { let d: number = 7, buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (view.setFloat64(0, d / 3), view.getFloat64(0)); } return b; }
p(213, k213(1.5), k213(0), k213(2));
function k214(y: number) { let d: number = 7, buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (view.setInt8(0, d / 3), view.getInt8(0)); } return b; }
p(214, k214(1.5), k214(0), k214(2));
function k215(y: number) { let buffer = new ArrayBuffer(16), view = new DataView(buffer); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = view.getBigInt64(0); } return b; }
p(215, k215(1.5), k215(0), k215(2));
function k216(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof Date.now(); } return b; }
p(216, k216(1.5), k216(0), k216(2));
function k217(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof Math.random(); } return b; }
p(217, k217(1.5), k217(0), k217(2));
function k218(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Math.random() < 2; } return b; }
p(218, k218(1.5), k218(0), k218(2));
function k219(y: number) { let date = new Date(86400000.5 * 400); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = date.toISOString(); } return b; }
p(219, k219(1.5), k219(0), k219(2));
function k220(y: number) { let date = new Date(86400000.5 * 400); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof date.getFullYear(); } return b; }
p(220, k220(1.5), k220(0), k220(2));
function k221(y: number) { let date = new Date(86400000.5 * 400); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = typeof date.getTimezoneOffset(); } return b; }
p(221, k221(1.5), k221(0), k221(2));
function k222(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = plus.bind(null, d / 3)(); } return b; }
p(222, k222(1.5), k222(0), k222(2));
function k223(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Reflect.apply(plus, null, [d / 3]); } return b; }
p(223, k223(1.5), k223(0), k223(2));
function k224(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = plus.apply(null, [d / 3]); } return b; }
p(224, k224(1.5), k224(0), k224(2));
function k225(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = plus.call(null, d / 3); } return b; }
p(225, k225(1.5), k225(0), k225(2));
function k226(y: number) { let d: number = 7; let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = Reflect.construct(Box, [d / 3]); } return b; }
p(226, k226(1.5), k226(0), k226(2));
function k227(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new Error('e' + i).message; } return b; }
p(227, k227(1.5), k227(0), k227(2));
function k228(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new TypeError('t').name; } return b; }
p(228, k228(1.5), k228(0), k228(2));
function k229(y: number) { let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = new RangeError('r') instanceof Error; } return b; }
p(229, k229(1.5), k229(0), k229(2));
function k230(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = node.toString('hex'); } return b; }
p(230, k230(1.5), k230(0), k230(2));
function k231(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), node2 = Buffer.alloc(8); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = (node.copy(node2), node2[0]); } return b; }
p(231, k231(1.5), k231(0), k231(2));
function k232(y: number) { let node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); let b: any = undefined, i = 0; while (i < (y & 3) + 1) { i++; b = node.readBigInt64LE(0); } return b; }
p(232, k232(1.5), k232(0), k232(2));
