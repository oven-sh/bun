// Eight records end in one name, written in no order of size, every field required. A row's plan is chosen from the fewest fields up: one plan is tried for each of the eight lists of names, not one for every wider record that stands in front.
// COUNTER: RecordPlansTried <= 8
// COUNTER: ObjectsParsedIntoRecords >= 320
interface R5 { a: number; b: number; c: number; d: number; e: number; z: number }
interface R2 { a: number; b: number; z: number }
interface R8 { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; z: number }
interface R1 { a: number; z: number }
interface R6 { a: number; b: number; c: number; d: number; e: number; f: number; z: number }
interface R3 { a: number; b: number; c: number; z: number }
interface R7 { a: number; b: number; c: number; d: number; e: number; f: number; g: number; z: number }
interface R4 { a: number; b: number; c: number; d: number; z: number }
const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
function text(width: number, from: number): string { const rows: string[] = []; for (let i = 0; i < 40; i++) rows.push("{" + names.slice(from, width).map((n, k) => '"' + n + '":' + (i + k)).join() + ',"z":' + width + "}"); return "[" + rows.join() + "]"; }
function s1(rows: R1[]): number { let s = 0; for (const r of rows) s += r.a + r.z; return s; }
function s2(rows: R2[]): number { let s = 0; for (const r of rows) s += r.a + r.b + r.z; return s; }
function s3(rows: R3[]): number { let s = 0; for (const r of rows) s += r.a + r.c + r.z; return s; }
function s4(rows: R4[]): number { let s = 0; for (const r of rows) s += r.a + r.d + r.z; return s; }
function s5(rows: R5[]): number { let s = 0; for (const r of rows) s += r.a + r.e + r.z; return s; }
function s6(rows: R6[]): number { let s = 0; for (const r of rows) s += r.a + r.f + r.z; return s; }
function s7(rows: R7[]): number { let s = 0; for (const r of rows) s += r.a + r.g + r.z; return s; }
function s8(rows: R8[]): number { let s = 0; for (const r of rows) s += r.a + r.h + r.z; return s; }
const out: (number | string)[] = [];
const r1: R1[] = JSON.parse(text(1, 0)); out.push(s1(r1)); const r2: R2[] = JSON.parse(text(2, 0)); out.push(s2(r2)); const r3: R3[] = JSON.parse(text(3, 0)); out.push(s3(r3)); const r4: R4[] = JSON.parse(text(4, 0)); out.push(s4(r4));
const r5: R5[] = JSON.parse(text(5, 0)); out.push(s5(r5)); const r6: R6[] = JSON.parse(text(6, 0)); out.push(s6(r6)); const r7: R7[] = JSON.parse(text(7, 0)); out.push(s7(r7)); const r8: R8[] = JSON.parse(text(8, 0)); out.push(s8(r8));
console.log(out.join(" ")); export {};
