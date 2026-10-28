// The stubs that push, store and load one array element for code that runs once, on every storage shape: growth, holes, keys that are not array indices, -0 and NaN, young objects in old arrays, and arrays that are frozen, copy-on-write, sparse, subclassed or inherit elements.
// CALLS+ pushOntoInt32s ArrayPush\b
// CALLS+ pushNumbers ArrayPushDouble
// CALLS+ storeIntoInt32s StoreElement
// CALLS+ storeNumbers StoreDoubleElement
// CALLS+ loadFromInt32s LoadElement
"use strict";

type Box = { id: number };

const shell = globalThis as any;
const collectFull: () => void = shell.gc ?? (() => Bun.gc(true));
const collectYoung: () => void = shell.edenGC ?? require("bun:jsc").edenGC;

const sink: unknown[] = [];
function opaque(value: unknown): unknown { sink.push(value); return sink.pop(); }
function opaqueNumber(value: number): number { return Number(opaque(value)); }

const v = { int32: opaque(7), half: opaque(1.5), nan: opaque(NaN), negativeZero: opaque(-0), big: opaque(2 ** 31), text: opaque("text"), box: opaque({ id: 1 }), nothing: opaque(undefined) };
const d = { int32: opaqueNumber(7), half: opaqueNumber(1.5), nan: opaqueNumber(NaN), negativeZero: opaqueNumber(-0), big: opaqueNumber(2 ** 31) };
const one = opaqueNumber(1);

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return "{" + (value as Box).id + "}";
  return String(value);
}
function describe(array: readonly unknown[]): string {
  let text = "length " + array.length + ":";
  for (const key of Object.keys(array)) text += " " + key + "=" + show((array as any)[key]);
  return text;
}
function results(name: string, returned: readonly unknown[], arrays: readonly (readonly unknown[])[]): void {
  for (let i = 0; i < returned.length; i++) console.log(name + " " + i + " -> " + show(returned[i]) + " | " + describe(arrays[i]));
}
function contents(name: string, arrays: readonly (readonly unknown[])[]): void {
  for (let i = 0; i < arrays.length; i++) console.log(name + " " + i + " | " + describe(arrays[i]));
}
function values(name: string, loaded: readonly unknown[]): void {
  let text = name + " ->";
  for (let i = 0; i < loaded.length; i++) text += " " + (i in loaded ? show(loaded[i]) : "hole");
  console.log(text);
}
function failure(name: string, error: unknown): void {
  console.log(name + " throws " + (error as Error).name + ": " + (error as Error).message);
}

function several<T>(make: () => T, count: number): T[] {
  const all: T[] = [];
  for (let i = 0; i < count; i++) all.push(make());
  return all;
}
function each<T>(...creators: (() => T)[]): T[] {
  const all: T[] = [];
  for (const make of creators) all.push(make());
  return all;
}
function withRoom(array: any[]): any[] {
  const length = array.length;
  while (array.length < 12) array.push(array[0]);
  array.length = length;
  return array;
}
function withHole(array: any[]): any[] { delete array[1]; return array; }
function withNamedProperties(array: any[]): any[] { array[-1] = "minus one"; array[2 ** 32 - 1] = "not an index"; array[2 ** 32] = "past every index"; return array; }

function emptyLiteral(): any[] { return []; }
function int32s(): any[] { return withRoom(JSON.parse("[1,2,3]")); }
function doubles(): any[] { return withRoom(JSON.parse("[1.5,2.5,3.5]")); }
function mixed(): any[] { return withRoom(JSON.parse('[1,"two",{"id":3}]')); }
function strings(): any[] { return withRoom(JSON.parse('["a","b","c"]')); }
function boxedNumbers(): any[] { const array = mixed(); array[1] = 2.5; array[2] = 3; return array; }
function int32Literal(): number[] { const i = one | 0; return [i, (i + 1) | 0, (i + 2) | 0]; }
function doubleLiteral(): number[] { return [one + 0.5, one + 1.5, one + 2.5]; }
function mixedLiteral(): unknown[] { return [one, "two", { id: 3 }]; }
function stringLiteral(): string[] { return ["a" + one, "b" + one, "c" + one]; }
const makers: Record<string, () => any[]> = { "empty literal": emptyLiteral, int32s, doubles, mixed, strings };

function pushOntoEmptyLiterals(t: unknown[][], u: any[]): void {
  results("empty literal push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("empty literal push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoInt32s(t: unknown[][], u: any[]): void {
  results("int32s push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("int32s push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoDoubles(t: unknown[][], u: any[]): void {
  results("doubles push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("doubles push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoMixed(t: unknown[][], u: any[]): void {
  results("mixed push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("mixed push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoStrings(t: unknown[][], u: any[]): void {
  results("strings push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("strings push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoInt32Literals(t: unknown[][], u: any[]): void {
  results("int32 literal push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("int32 literal push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoDoubleLiterals(t: unknown[][], u: any[]): void {
  results("double literal push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("double literal push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoMixedLiterals(t: unknown[][], u: any[]): void {
  results("mixed literal push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("mixed literal push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function pushOntoStringLiterals(t: unknown[][], u: any[]): void {
  results("string literal push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.nan), t[3].push(v.negativeZero), t[4].push(v.big), t[5].push(v.text), t[6].push(v.box), t[7].push(v.nothing)], t);
  results("string literal push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.nan), u[3].push(v.negativeZero), u[4].push(v.big), u[5].push(v.text), u[6].push(v.box), u[7].push(v.nothing)], u);
}

function growFromEmpty(t: unknown[][], u: any[]): void {
  const a = t[0], b = t[1], c = t[2], e = t[3];
  values("grow by int32", [a.push(v.int32), a.push(v.int32), a.push(v.int32), a.push(v.int32), a.push(v.int32), a.push(v.int32), a.push(v.int32), a.push(v.int32), a.push(v.int32)]);
  values("grow by double", [b.push(v.half), b.push(v.half), b.push(v.half), b.push(v.half), b.push(v.half), b.push(v.half), b.push(v.half), b.push(v.half), b.push(v.half)]);
  values("grow by string", [c.push(v.text), c.push(v.text), c.push(v.text), c.push(v.text), c.push(v.text), c.push(v.text), c.push(v.text), c.push(v.text), c.push(v.text)]);
  values("grow by object", [e.push(v.box), e.push(v.box), e.push(v.box), e.push(v.box), e.push(v.box), e.push(v.box), e.push(v.box), e.push(v.box), e.push(v.box)]);
  contents("grown", t);
  const f = u[0], g = u[1], h = u[2], i = u[3];
  values("grow by int32, any", [f.push(v.int32), f.push(v.int32), f.push(v.int32), f.push(v.int32), f.push(v.int32), f.push(v.int32), f.push(v.int32), f.push(v.int32), f.push(v.int32)]);
  values("grow by double, any", [g.push(v.half), g.push(v.half), g.push(v.half), g.push(v.half), g.push(v.half), g.push(v.half), g.push(v.half), g.push(v.half), g.push(v.half)]);
  values("grow by string, any", [h.push(v.text), h.push(v.text), h.push(v.text), h.push(v.text), h.push(v.text), h.push(v.text), h.push(v.text), h.push(v.text), h.push(v.text)]);
  values("grow by object, any", [i.push(v.box), i.push(v.box), i.push(v.box), i.push(v.box), i.push(v.box), i.push(v.box), i.push(v.box), i.push(v.box), i.push(v.box)]);
  contents("grown, any", u);
}

function pushNumbers(i: number[][], f: number[][], c: number[][], tight: number[][]): void {
  results("int32s push number", [i[0].push(d.int32 * one), i[1].push(d.half * one), i[2].push(d.nan * one), i[3].push(d.negativeZero * one), i[4].push(d.big * one)], i);
  results("doubles push number", [f[0].push(d.int32 * one), f[1].push(d.half * one), f[2].push(d.nan * one), f[3].push(d.negativeZero * one), f[4].push(d.big * one)], f);
  results("boxed numbers push number", [c[0].push(d.int32 * one), c[1].push(d.half * one), c[2].push(d.nan * one), c[3].push(d.negativeZero * one), c[4].push(d.big * one)], c);
  results("literals push number", [tight[0].push(d.int32 * one), tight[1].push(d.half * one), tight[2].push(d.int32 * one), tight[3].push(d.half * one), tight[4].push(d.nan * one)], tight);
}

function storeIntoEmptyLiterals(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  t[0][n] = v.int32; t[1][n] = v.half; t[2][n] = v.nan; t[3][n] = v.negativeZero; t[4][n] = v.big; t[5][n] = v.text; t[6][n] = v.box; t[7][n] = v.nothing;
  t[8][n + 2] = v.int32; t[9][n + 2] = v.half; t[10][n + 2] = v.box; t[11][n + 40] = v.int32; t[12][n + 40] = v.half; t[13][n + 40] = v.box;
  t[14][n - 1] = v.int32; t[15][n - 1] = v.box; t[16][n + 4294967294] = v.int32; t[17][n + 4294967295] = v.half; t[18][n + 4294967296] = v.box;
  contents("empty literal store", t);
  u[0][n] = v.int32; u[1][n] = v.half; u[2][n] = v.nan; u[3][n] = v.negativeZero; u[4][n] = v.big; u[5][n] = v.text; u[6][n] = v.box; u[7][n] = v.nothing;
  u[8][n + 2] = v.int32; u[9][n + 2] = v.half; u[10][n + 2] = v.box; u[11][n + 40] = v.int32; u[12][n + 40] = v.half; u[13][n + 40] = v.box;
  u[14][n - 1] = v.int32; u[15][n - 1] = v.box; u[16][n + 4294967294] = v.int32; u[17][n + 4294967295] = v.half; u[18][n + 4294967296] = v.box;
  contents("empty literal store, any", u);
}

function storeIntoInt32s(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  t[0][n - 2] = v.int32; t[1][n - 2] = v.half; t[2][n - 2] = v.nan; t[3][n - 2] = v.negativeZero; t[4][n - 2] = v.big; t[5][n - 2] = v.text; t[6][n - 2] = v.box; t[7][n - 2] = v.nothing;
  t[8][n] = v.int32; t[9][n] = v.half; t[10][n] = v.nan; t[11][n] = v.negativeZero; t[12][n] = v.big; t[13][n] = v.text; t[14][n] = v.box; t[15][n] = v.nothing;
  t[16][n + 2] = v.int32; t[17][n + 2] = v.half; t[18][n + 2] = v.box; t[19][n + 40] = v.int32; t[20][n + 40] = v.half; t[21][n + 40] = v.box;
  t[22][n - 4] = v.int32; t[23][n - 4] = v.box; t[24][n + 4294967291] = v.int32; t[25][n + 4294967292] = v.half; t[26][n + 4294967293] = v.box;
  contents("int32s store", t);
  u[0][n - 2] = v.int32; u[1][n - 2] = v.half; u[2][n - 2] = v.nan; u[3][n - 2] = v.negativeZero; u[4][n - 2] = v.big; u[5][n - 2] = v.text; u[6][n - 2] = v.box; u[7][n - 2] = v.nothing;
  u[8][n] = v.int32; u[9][n] = v.half; u[10][n] = v.nan; u[11][n] = v.negativeZero; u[12][n] = v.big; u[13][n] = v.text; u[14][n] = v.box; u[15][n] = v.nothing;
  u[16][n + 2] = v.int32; u[17][n + 2] = v.half; u[18][n + 2] = v.box; u[19][n + 40] = v.int32; u[20][n + 40] = v.half; u[21][n + 40] = v.box;
  u[22][n - 4] = v.int32; u[23][n - 4] = v.box; u[24][n + 4294967291] = v.int32; u[25][n + 4294967292] = v.half; u[26][n + 4294967293] = v.box;
  contents("int32s store, any", u);
}

function storeIntoDoubles(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  t[0][n - 2] = v.int32; t[1][n - 2] = v.half; t[2][n - 2] = v.nan; t[3][n - 2] = v.negativeZero; t[4][n - 2] = v.big; t[5][n - 2] = v.text; t[6][n - 2] = v.box; t[7][n - 2] = v.nothing;
  t[8][n] = v.int32; t[9][n] = v.half; t[10][n] = v.nan; t[11][n] = v.negativeZero; t[12][n] = v.big; t[13][n] = v.text; t[14][n] = v.box; t[15][n] = v.nothing;
  t[16][n + 2] = v.int32; t[17][n + 2] = v.half; t[18][n + 2] = v.box; t[19][n + 40] = v.int32; t[20][n + 40] = v.half; t[21][n + 40] = v.box;
  t[22][n - 4] = v.int32; t[23][n - 4] = v.box; t[24][n + 4294967291] = v.int32; t[25][n + 4294967292] = v.half; t[26][n + 4294967293] = v.box;
  contents("doubles store", t);
  u[0][n - 2] = v.int32; u[1][n - 2] = v.half; u[2][n - 2] = v.nan; u[3][n - 2] = v.negativeZero; u[4][n - 2] = v.big; u[5][n - 2] = v.text; u[6][n - 2] = v.box; u[7][n - 2] = v.nothing;
  u[8][n] = v.int32; u[9][n] = v.half; u[10][n] = v.nan; u[11][n] = v.negativeZero; u[12][n] = v.big; u[13][n] = v.text; u[14][n] = v.box; u[15][n] = v.nothing;
  u[16][n + 2] = v.int32; u[17][n + 2] = v.half; u[18][n + 2] = v.box; u[19][n + 40] = v.int32; u[20][n + 40] = v.half; u[21][n + 40] = v.box;
  u[22][n - 4] = v.int32; u[23][n - 4] = v.box; u[24][n + 4294967291] = v.int32; u[25][n + 4294967292] = v.half; u[26][n + 4294967293] = v.box;
  contents("doubles store, any", u);
}

function storeIntoMixed(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  t[0][n - 2] = v.int32; t[1][n - 2] = v.half; t[2][n - 2] = v.nan; t[3][n - 2] = v.negativeZero; t[4][n - 2] = v.big; t[5][n - 2] = v.text; t[6][n - 2] = v.box; t[7][n - 2] = v.nothing;
  t[8][n] = v.int32; t[9][n] = v.half; t[10][n] = v.nan; t[11][n] = v.negativeZero; t[12][n] = v.big; t[13][n] = v.text; t[14][n] = v.box; t[15][n] = v.nothing;
  t[16][n + 2] = v.int32; t[17][n + 2] = v.half; t[18][n + 2] = v.box; t[19][n + 40] = v.int32; t[20][n + 40] = v.half; t[21][n + 40] = v.box;
  t[22][n - 4] = v.int32; t[23][n - 4] = v.box; t[24][n + 4294967291] = v.int32; t[25][n + 4294967292] = v.half; t[26][n + 4294967293] = v.box;
  contents("mixed store", t);
  u[0][n - 2] = v.int32; u[1][n - 2] = v.half; u[2][n - 2] = v.nan; u[3][n - 2] = v.negativeZero; u[4][n - 2] = v.big; u[5][n - 2] = v.text; u[6][n - 2] = v.box; u[7][n - 2] = v.nothing;
  u[8][n] = v.int32; u[9][n] = v.half; u[10][n] = v.nan; u[11][n] = v.negativeZero; u[12][n] = v.big; u[13][n] = v.text; u[14][n] = v.box; u[15][n] = v.nothing;
  u[16][n + 2] = v.int32; u[17][n + 2] = v.half; u[18][n + 2] = v.box; u[19][n + 40] = v.int32; u[20][n + 40] = v.half; u[21][n + 40] = v.box;
  u[22][n - 4] = v.int32; u[23][n - 4] = v.box; u[24][n + 4294967291] = v.int32; u[25][n + 4294967292] = v.half; u[26][n + 4294967293] = v.box;
  contents("mixed store, any", u);
}

function storeIntoStrings(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  t[0][n - 2] = v.int32; t[1][n - 2] = v.half; t[2][n - 2] = v.nan; t[3][n - 2] = v.negativeZero; t[4][n - 2] = v.big; t[5][n - 2] = v.text; t[6][n - 2] = v.box; t[7][n - 2] = v.nothing;
  t[8][n] = v.int32; t[9][n] = v.half; t[10][n] = v.nan; t[11][n] = v.negativeZero; t[12][n] = v.big; t[13][n] = v.text; t[14][n] = v.box; t[15][n] = v.nothing;
  t[16][n + 2] = v.int32; t[17][n + 2] = v.half; t[18][n + 2] = v.box; t[19][n + 40] = v.int32; t[20][n + 40] = v.half; t[21][n + 40] = v.box;
  t[22][n - 4] = v.int32; t[23][n - 4] = v.box; t[24][n + 4294967291] = v.int32; t[25][n + 4294967292] = v.half; t[26][n + 4294967293] = v.box;
  contents("strings store", t);
  u[0][n - 2] = v.int32; u[1][n - 2] = v.half; u[2][n - 2] = v.nan; u[3][n - 2] = v.negativeZero; u[4][n - 2] = v.big; u[5][n - 2] = v.text; u[6][n - 2] = v.box; u[7][n - 2] = v.nothing;
  u[8][n] = v.int32; u[9][n] = v.half; u[10][n] = v.nan; u[11][n] = v.negativeZero; u[12][n] = v.big; u[13][n] = v.text; u[14][n] = v.box; u[15][n] = v.nothing;
  u[16][n + 2] = v.int32; u[17][n + 2] = v.half; u[18][n + 2] = v.box; u[19][n + 40] = v.int32; u[20][n + 40] = v.half; u[21][n + 40] = v.box;
  u[22][n - 4] = v.int32; u[23][n - 4] = v.box; u[24][n + 4294967291] = v.int32; u[25][n + 4294967292] = v.half; u[26][n + 4294967293] = v.box;
  contents("strings store, any", u);
}

function storeIntoLiterals(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  t[0][n] = v.int32; t[1][n] = v.half; t[2][n] = v.box; t[3][n] = v.int32; t[4][n] = v.half; t[5][n] = v.box; t[6][n] = v.int32; t[7][n] = v.box; t[8][n] = v.text; t[9][n] = v.int32;
  contents("literal store at the length", t);
  u[0][n] = v.int32; u[1][n] = v.half; u[2][n] = v.box; u[3][n] = v.int32; u[4][n] = v.half; u[5][n] = v.box; u[6][n] = v.int32; u[7][n] = v.box; u[8][n] = v.text; u[9][n] = v.int32;
  contents("literal store at the length, any", u);
}

function storeNumbers(i: number[][], f: number[][], c: number[][]): void {
  const n = i[0].length;
  i[0][n - 2] = d.int32 * one; i[1][n - 2] = d.half * one; i[2][n - 2] = d.nan * one; i[3][n - 2] = d.negativeZero * one; i[4][n - 2] = d.big * one; i[5][n] = d.int32 * one; i[6][n] = d.half * one; i[7][n] = d.nan * one; i[8][n + 2] = d.half * one; i[9][n + 40] = d.half * one; i[10][n - 4] = d.half * one; i[11][n + 4294967293] = d.half * one;
  contents("int32s store number", i);
  f[0][n - 2] = d.int32 * one; f[1][n - 2] = d.half * one; f[2][n - 2] = d.nan * one; f[3][n - 2] = d.negativeZero * one; f[4][n - 2] = d.big * one; f[5][n] = d.int32 * one; f[6][n] = d.half * one; f[7][n] = d.nan * one; f[8][n + 2] = d.half * one; f[9][n + 40] = d.half * one; f[10][n - 4] = d.half * one; f[11][n + 4294967293] = d.half * one;
  contents("doubles store number", f);
  c[0][n - 2] = d.int32 * one; c[1][n - 2] = d.half * one; c[2][n - 2] = d.nan * one; c[3][n - 2] = d.negativeZero * one; c[4][n - 2] = d.big * one; c[5][n] = d.int32 * one; c[6][n] = d.half * one; c[7][n] = d.nan * one; c[8][n + 2] = d.half * one; c[9][n + 40] = d.half * one; c[10][n - 4] = d.half * one; c[11][n + 4294967293] = d.half * one;
  contents("boxed numbers store number", c);
}

function loadFromEmptyLiterals(a: unknown[], b: any): void {
  const n = a.length;
  values("empty literal load", [a[n], a[n + 1], a[n + 2], a[n + 3], a[n + 5], a[n + 43], a[n - 1], a[n + 4294967294], a[n + 4294967295], a[n + 4294967296]]);
  values("empty literal load, any", [b[n], b[n + 1], b[n + 2], b[n + 3], b[n + 5], b[n + 43], b[n - 1], b[n + 4294967294], b[n + 4294967295], b[n + 4294967296]]);
}

function loadFromInt32s(a: unknown[], b: any): void {
  const n = a.length;
  values("int32s load", [a[n - 3], a[n - 2], a[n - 1], a[n], a[n + 2], a[n + 40], a[n - 4], a[n + 4294967291], a[n + 4294967292], a[n + 4294967293]]);
  values("int32s load, any", [b[n - 3], b[n - 2], b[n - 1], b[n], b[n + 2], b[n + 40], b[n - 4], b[n + 4294967291], b[n + 4294967292], b[n + 4294967293]]);
}

function loadFromDoubles(a: unknown[], b: any): void {
  const n = a.length;
  values("doubles load", [a[n - 3], a[n - 2], a[n - 1], a[n], a[n + 2], a[n + 40], a[n - 4], a[n + 4294967291], a[n + 4294967292], a[n + 4294967293]]);
  values("doubles load, any", [b[n - 3], b[n - 2], b[n - 1], b[n], b[n + 2], b[n + 40], b[n - 4], b[n + 4294967291], b[n + 4294967292], b[n + 4294967293]]);
}

function loadFromMixed(a: unknown[], b: any): void {
  const n = a.length;
  values("mixed load", [a[n - 3], a[n - 2], a[n - 1], a[n], a[n + 2], a[n + 40], a[n - 4], a[n + 4294967291], a[n + 4294967292], a[n + 4294967293]]);
  values("mixed load, any", [b[n - 3], b[n - 2], b[n - 1], b[n], b[n + 2], b[n + 40], b[n - 4], b[n + 4294967291], b[n + 4294967292], b[n + 4294967293]]);
}

function loadFromStrings(a: unknown[], b: any): void {
  const n = a.length;
  values("strings load", [a[n - 3], a[n - 2], a[n - 1], a[n], a[n + 2], a[n + 40], a[n - 4], a[n + 4294967291], a[n + 4294967292], a[n + 4294967293]]);
  values("strings load, any", [b[n - 3], b[n - 2], b[n - 1], b[n], b[n + 2], b[n + 40], b[n - 4], b[n + 4294967291], b[n + 4294967292], b[n + 4294967293]]);
}

function loadFromInt32sWithNamedProperties(a: unknown[], b: any): void {
  const n = a.length;
  values("int32s with named properties load", [a[n - 3], a[n - 2], a[n - 1], a[n], a[n + 2], a[n + 40], a[n - 4], a[n + 4294967291], a[n + 4294967292], a[n + 4294967293]]);
  values("int32s with named properties load, any", [b[n - 3], b[n - 2], b[n - 1], b[n], b[n + 2], b[n + 40], b[n - 4], b[n + 4294967291], b[n + 4294967292], b[n + 4294967293]]);
}

function loadFromDoublesWithNamedProperties(a: unknown[], b: any): void {
  const n = a.length;
  values("doubles with named properties load", [a[n - 3], a[n - 2], a[n - 1], a[n], a[n + 2], a[n + 40], a[n - 4], a[n + 4294967291], a[n + 4294967292], a[n + 4294967293]]);
  values("doubles with named properties load, any", [b[n - 3], b[n - 2], b[n - 1], b[n], b[n + 2], b[n + 40], b[n - 4], b[n + 4294967291], b[n + 4294967292], b[n + 4294967293]]);
}

function loadWholeNumbersFromDoubles(a: unknown[], b: any, c: number[]): void {
  const n = a.length;
  values("whole numbers among doubles", [a[n - 10], a[n - 9], a[n - 8], a[n - 7], a[n - 6], a[n - 5], a[n - 4], a[n - 3], a[n - 2], a[n - 1]]);
  values("whole numbers among doubles, any", [b[n - 10], b[n - 9], b[n - 8], b[n - 7], b[n - 6], b[n - 5], b[n - 4], b[n - 3], b[n - 2], b[n - 1]]);
  values("whole numbers among doubles, as numbers", [c[n - 10], c[n - 9], c[n - 8], c[n - 7], c[n - 6], c[n - 5], c[n - 4], c[n - 3], c[n - 2], c[n - 1]]);
  values("Object.is on whole numbers among doubles", [Object.is(a[n - 9], 2), Object.is(a[n - 8], -0), Object.is(a[n - 8], 0), Object.is(a[n - 7], 0), Object.is(a[n - 7], -0), Object.is(b[n - 8], -0), Object.is(c[n - 8], -0), Object.is(c[n - 6], 2147483647)]);
  values("sums of whole numbers among doubles", [c[n - 9] + c[n - 8], 1 / c[n - 8], c[n - 7] + 1, c[n - 5] - 1, c[n - 1] + c[n - 1]]);
}

function loadNumbers(i: number[], f: number[], c: number[]): void {
  const n = i.length;
  values("int32s load number", [i[n - 3], i[n - 2], i[n - 1], i[n], i[n + 2], i[n + 40], i[n - 4], i[n + 4294967291], i[n + 4294967292], i[n + 4294967293]]);
  values("doubles load number", [f[n - 3], f[n - 2], f[n - 1], f[n], f[n + 2], f[n + 40], f[n - 4], f[n + 4294967291], f[n + 4294967292], f[n + 4294967293]]);
  values("boxed numbers load number", [c[n - 3], c[n - 2], c[n - 1], c[n], c[n + 2], c[n + 40], c[n - 4], c[n + 4294967291], c[n + 4294967292], c[n + 4294967293]]);
}

function visitElements(t: unknown[][]): void {
  values("map over int32s", t[0].map(show));
  values("map over doubles", t[1].map(show));
  values("map over mixed", t[2].map(show));
  values("map over strings", t[3].map(show));
  values("map over holes", t[4].map(show));
  values("filter", [t[0].filter(() => true).length, t[1].filter(() => true).length, t[2].filter(() => true).length, t[3].filter(() => true).length, t[4].filter(() => true).length]);
  values("map over an array-like object", (Array.prototype.map as any).call({ length: 4, 0: "first", 2: 2.5 }, show));
  values("map over a string", (Array.prototype.map as any).call("text", show));
  values("map over a number", (Array.prototype.map as any).call(5, show));
}

// The stubs save and restore the floating-point registers they borrow, so a caller may hold doubles in them across a call.
function pushWithLiveDoubles(t: unknown[][], x: number): void {
  const p = x * 1.5, q = x * 2.5, r = x * 3.5, s = x * 4.5;
  t[0].push(v.half); t[1].push(v.int32); t[2].push(v.nan); t[3].push(v.half); t[4].push(v.half); t[5].push(v.box);
  values("doubles live across push", [p, q, r, s]);
  contents("push with live doubles", t);
}

function pushNumbersWithLiveDoubles(f: number[][], x: number): void {
  const p = x * 1.5, q = x * 2.5, r = x * 3.5, s = x * 4.5;
  f[0].push(d.half * one); f[1].push(d.int32 * one); f[2].push(d.nan * one); f[3].push(d.half * one); f[4].push(d.half * one);
  values("doubles live across push of a number", [p, q, r, s]);
  contents("push of a number with live doubles", f);
}

function storeWithLiveDoubles(t: unknown[][], x: number): void {
  const n = t[0].length;
  const p = x * 1.5, q = x * 2.5, r = x * 3.5, s = x * 4.5;
  t[0][n - 2] = v.half; t[1][n - 2] = v.int32; t[2][n - 2] = v.nan; t[3][n + 40] = v.half; t[4][n - 2] = v.half; t[5][n - 2] = v.box;
  values("doubles live across store", [p, q, r, s]);
  contents("store with live doubles", t);
}

function storeNumbersWithLiveDoubles(c: number[][], x: number): void {
  const n = c[0].length;
  const p = x * 1.5, q = x * 2.5, r = x * 3.5, s = x * 4.5;
  c[0][n - 2] = d.half * one; c[1][n - 2] = d.int32 * one; c[2][n - 2] = d.nan * one; c[3][n + 40] = d.half * one; c[4][n - 2] = d.half * one; c[5][n - 2] = d.half * one;
  values("doubles live across store of a number", [p, q, r, s]);
  contents("store of a number with live doubles", c);
}

function loadWithLiveDoubles(a: unknown[], holey: unknown[], notPristine: unknown[], x: number): void {
  const n = a.length;
  const p = x * 1.5, q = x * 2.5, r = x * 3.5, s = x * 4.5;
  const fraction = a[n - 3], whole = a[n - 2], negativeZero = a[n - 1], pastTheEnd = a[n], hole = holey[n - 2], inherited = notPristine[n - 2];
  values("doubles live across load", [p, q, r, s]);
  values("load with live doubles", [fraction, whole, negativeZero, pastTheEnd, hole, inherited]);
}

const marks = [1, 2, 3, 4, 7, 8, 31, 32, 33, 100, 101];
function grow(name: string, array: unknown[], value: unknown): void {
  let text = "";
  while (array.length < 101) {
    const length = array.push(value);
    if (marks.includes(length)) text += " " + length;
  }
  let found = 0;
  for (let i = 0; i < array.length; i++) if (Object.is(array[i], value)) found++;
  console.log(name + ":" + text + " | " + found + " of " + array.length);
}
function growAny(name: string, array: any, value: unknown): void {
  let text = "";
  while (array.length < 101) {
    const length = array.push(value);
    if (marks.includes(length)) text += " " + length;
  }
  let found = 0;
  for (let i = 0; i < array.length; i++) if (Object.is(array[i], value)) found++;
  console.log(name + ":" + text + " | " + found + " of " + array.length);
}
function storeAt(array: unknown[], index: number, value: unknown): void { array[index] = value; }
function storeAtAny(array: any, index: number, value: unknown): void { array[index] = value; }
function loadAt(array: unknown[], index: number): unknown { return array[index]; }
function loadAtAny(array: any, index: number): unknown { return array[index]; }

const ring: unknown[] = new Array(1024);
function churn(): void {
  for (let i = 0; i < 200000; i++) ring[i & 1023] = i & 1 ? { id: -i } : [i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6];
}
function createLargeArray(): Box[] {
  const array: Box[] = [];
  for (let i = 0; i < 2010; i++) array.push({ id: i });
  array.length = 2000;
  return array;
}
function createSmallArray(): Box[] { return withRoom([{ id: 0 }, { id: 1 }, { id: 2 }]); }
function fillOldArrays(large: Box[], small: Box[], largeAny: any, smallAny: any): void {
  const n = large.length, m = small.length;
  values("push onto old arrays", [large.push({ id: 9000 }), large.push({ id: 9001 }), small.push({ id: 9100 }), small.push({ id: 9101 }), largeAny.push({ id: 9200 }), largeAny.push({ id: 9201 }), smallAny.push({ id: 9300 }), smallAny.push({ id: 9301 })]);
  large[n - 7] = { id: 9002 }; large[n + 2] = { id: 9003 }; large[n + 4] = { id: 9004 };
  small[m - 2] = { id: 9102 }; small[m + 2] = { id: 9103 }; small[m + 4] = { id: 9104 };
  largeAny[n - 7] = { id: 9202 }; largeAny[n + 2] = { id: 9203 }; largeAny[n + 4] = { id: 9204 };
  smallAny[m - 2] = { id: 9302 }; smallAny[m + 2] = { id: 9303 }; smallAny[m + 4] = { id: 9304 };
}
function sumOfIds(array: Box[]): number {
  let sum = 0;
  for (let i = 0; i < array.length; i++) if (i in array) sum += array[i].id;
  return sum;
}
function readOldArrays(large: Box[], small: Box[], largeAny: any, smallAny: any): void {
  const n = large.length, m = small.length;
  values("old large array", [n, large[n - 12], large[n - 5], large[n - 4], large[n - 3], large[n - 2], large[n - 1], sumOfIds(large)]);
  values("old small array", [m, small[m - 7], small[m - 5], small[m - 4], small[m - 3], small[m - 2], small[m - 1], sumOfIds(small)]);
  values("old large array, any", [largeAny.length, largeAny[n - 12], largeAny[n - 5], largeAny[n - 4], largeAny[n - 3], largeAny[n - 2], largeAny[n - 1], sumOfIds(largeAny)]);
  values("old small array, any", [smallAny.length, smallAny[m - 7], smallAny[m - 5], smallAny[m - 4], smallAny[m - 3], smallAny[m - 2], smallAny[m - 1], sumOfIds(smallAny)]);
}

function locked(lock: (array: any[]) => unknown): any[][] {
  const arrays = each(int32s, int32s, int32s, strings, strings, doubles);
  for (const array of arrays) lock(array);
  return arrays;
}

function useFrozenArrays(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  try { t[0].push(v.int32); } catch (error) { failure("frozen push", error); }
  try { t[1][n - 2] = v.int32; } catch (error) { failure("frozen store inside the length", error); }
  try { t[2][n] = v.int32; } catch (error) { failure("frozen store at the length", error); }
  try { t[3].push(v.box); } catch (error) { failure("frozen push onto strings", error); }
  try { t[4][n - 2] = v.box; } catch (error) { failure("frozen store into strings", error); }
  try { t[5][n - 2] = v.half; } catch (error) { failure("frozen store into doubles", error); }
  contents("frozen", t);
  try { u[0].push(v.int32); } catch (error) { failure("frozen push, any", error); }
  try { u[1][n - 2] = v.int32; } catch (error) { failure("frozen store inside the length, any", error); }
  try { u[2][n] = v.int32; } catch (error) { failure("frozen store at the length, any", error); }
  try { u[3].push(v.box); } catch (error) { failure("frozen push onto strings, any", error); }
  try { u[4][n - 2] = v.box; } catch (error) { failure("frozen store into strings, any", error); }
  try { u[5][n - 2] = v.half; } catch (error) { failure("frozen store into doubles, any", error); }
  contents("frozen, any", u);
  values("frozen load", [t[0][n - 2], t[0][n], t[0][n + 40], t[5][n - 2], u[0][n - 2], u[0][n], u[0][n + 40], u[5][n - 2]]);
}

function useSealedArrays(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  try { t[0].push(v.int32); } catch (error) { failure("sealed push", error); }
  try { t[1][n - 2] = v.int32; } catch (error) { failure("sealed store inside the length", error); }
  try { t[2][n] = v.int32; } catch (error) { failure("sealed store at the length", error); }
  try { t[3].push(v.box); } catch (error) { failure("sealed push onto strings", error); }
  try { t[4][n - 2] = v.box; } catch (error) { failure("sealed store into strings", error); }
  try { t[5][n - 2] = v.half; } catch (error) { failure("sealed store into doubles", error); }
  contents("sealed", t);
  try { u[0].push(v.int32); } catch (error) { failure("sealed push, any", error); }
  try { u[1][n - 2] = v.int32; } catch (error) { failure("sealed store inside the length, any", error); }
  try { u[2][n] = v.int32; } catch (error) { failure("sealed store at the length, any", error); }
  try { u[3].push(v.box); } catch (error) { failure("sealed push onto strings, any", error); }
  try { u[4][n - 2] = v.box; } catch (error) { failure("sealed store into strings, any", error); }
  try { u[5][n - 2] = v.half; } catch (error) { failure("sealed store into doubles, any", error); }
  contents("sealed, any", u);
  values("sealed load", [t[0][n - 2], t[0][n], t[0][n + 40], t[5][n - 2], u[0][n - 2], u[0][n], u[0][n + 40], u[5][n - 2]]);
}

function useNonExtensibleArrays(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  try { t[0].push(v.int32); } catch (error) { failure("non-extensible push", error); }
  try { t[1][n - 2] = v.int32; } catch (error) { failure("non-extensible store inside the length", error); }
  try { t[2][n] = v.int32; } catch (error) { failure("non-extensible store at the length", error); }
  try { t[3].push(v.box); } catch (error) { failure("non-extensible push onto strings", error); }
  try { t[4][n - 2] = v.box; } catch (error) { failure("non-extensible store into strings", error); }
  try { t[5][n - 2] = v.half; } catch (error) { failure("non-extensible store into doubles", error); }
  contents("non-extensible", t);
  try { u[0].push(v.int32); } catch (error) { failure("non-extensible push, any", error); }
  try { u[1][n - 2] = v.int32; } catch (error) { failure("non-extensible store inside the length, any", error); }
  try { u[2][n] = v.int32; } catch (error) { failure("non-extensible store at the length, any", error); }
  try { u[3].push(v.box); } catch (error) { failure("non-extensible push onto strings, any", error); }
  try { u[4][n - 2] = v.box; } catch (error) { failure("non-extensible store into strings, any", error); }
  try { u[5][n - 2] = v.half; } catch (error) { failure("non-extensible store into doubles, any", error); }
  contents("non-extensible, any", u);
  values("non-extensible load", [t[0][n - 2], t[0][n], t[0][n + 40], t[5][n - 2], u[0][n - 2], u[0][n], u[0][n + 40], u[5][n - 2]]);
}

function useArraysOfFixedLength(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  try { t[0].push(v.int32); } catch (error) { failure("read-only length push", error); }
  try { t[1][n - 2] = v.int32; } catch (error) { failure("read-only length store inside the length", error); }
  try { t[2][n] = v.int32; } catch (error) { failure("read-only length store at the length", error); }
  try { t[3].push(v.box); } catch (error) { failure("read-only length push onto strings", error); }
  try { t[4][n - 2] = v.box; } catch (error) { failure("read-only length store into strings", error); }
  try { t[5][n - 2] = v.half; } catch (error) { failure("read-only length store into doubles", error); }
  contents("read-only length", t);
  try { u[0].push(v.int32); } catch (error) { failure("read-only length push, any", error); }
  try { u[1][n - 2] = v.int32; } catch (error) { failure("read-only length store inside the length, any", error); }
  try { u[2][n] = v.int32; } catch (error) { failure("read-only length store at the length, any", error); }
  try { u[3].push(v.box); } catch (error) { failure("read-only length push onto strings, any", error); }
  try { u[4][n - 2] = v.box; } catch (error) { failure("read-only length store into strings, any", error); }
  try { u[5][n - 2] = v.half; } catch (error) { failure("read-only length store into doubles, any", error); }
  contents("read-only length, any", u);
  values("read-only length load", [t[0][n - 2], t[0][n], t[0][n + 40], t[5][n - 2], u[0][n - 2], u[0][n], u[0][n + 40], u[5][n - 2]]);
}

function constantInt32s(): number[] { return [10, 20, 30]; }
function constantDoubles(): number[] { return [10.5, 20.5, 30.5]; }
function constantStrings(): string[] { return ["x", "y", "z"]; }
function useConstantLiterals(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  results("constant literal push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.text)], t);
  t[3][n - 2] = v.int32; t[4][n - 2] = v.half; t[5][n - 2] = v.text; t[6][n] = v.int32; t[7][n] = v.half; t[8][n] = v.text;
  contents("constant literal", t);
  results("constant literal push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.text)], u);
  u[3][n - 2] = v.int32; u[4][n - 2] = v.half; u[5][n - 2] = v.text; u[6][n] = v.int32; u[7][n] = v.half; u[8][n] = v.text;
  contents("constant literal, any", u);
  values("constant literal load", [t[0][n - 2], t[1][n - 2], t[2][n - 2], t[0][n + 1], u[0][n - 2], u[1][n - 2], u[2][n - 2], u[0][n + 1]]);
}

function sparse(): any[] { const array = int32s(); array[200000] = 4; array.length = 3; return array; }
function holesOnly(): any[] { return new Array(3); }
function useOtherStorage(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  results("sparse and holes push", [t[0].push(v.int32), t[1].push(v.int32), t[2].push(v.half), t[3].push(v.box)], t);
  t[4][n - 2] = v.int32; t[5][n - 2] = v.int32; t[6][n - 2] = v.half; t[7][n] = v.box;
  contents("sparse and holes", t);
  results("sparse and holes push, any", [u[0].push(v.int32), u[1].push(v.int32), u[2].push(v.half), u[3].push(v.box)], u);
  u[4][n - 2] = v.int32; u[5][n - 2] = v.int32; u[6][n - 2] = v.half; u[7][n] = v.box;
  contents("sparse and holes, any", u);
  values("sparse and holes load", [t[8][n - 2], t[8][n], t[9][n - 2], t[9][n], u[8][n - 2], u[8][n], u[9][n - 2], u[9][n]]);
}

class Plain extends Array<unknown> {}
class Loud extends Array<unknown> {
  pushes = 0;
  push(...items: unknown[]): number { this.pushes++; return super.push(...items); }
}
function plain(): Plain { const array = new Plain(); array.push(1, 2, 3, 4, 5, 6); array.length = 3; delete array[1]; return array; }
function loud(): Loud { const array = new Loud(); array.push(1, 2, 3); return array; }
function useSubclasses(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  results("subclass push", [t[0].push(v.int32), t[1].push(v.box), t[2].push(v.int32), t[3].push(v.box)], t);
  t[4][n - 2] = v.int32; t[5][n] = v.box; t[6][n - 2] = v.half; t[7][n] = v.text;
  contents("subclass", t);
  results("subclass push, any", [u[0].push(v.int32), u[1].push(v.box), u[2].push(v.int32), u[3].push(v.box)], u);
  u[4][n - 2] = v.int32; u[5][n] = v.box; u[6][n - 2] = v.half; u[7][n] = v.text;
  contents("subclass, any", u);
  values("subclass load", [t[8][n - 3], t[8][n - 2], t[8][n], t[8][n - 4], u[8][n - 3], u[8][n - 2], u[8][n], u[8][n - 4]]);
}

function inheriting(make: () => any[]): any[] {
  const prototype = Object.create(Array.prototype);
  prototype[1] = "inherited";
  prototype[5] = "inherited past the length";
  return Object.setPrototypeOf(withHole(make()), prototype);
}
function inheritingInt32s(): any[] { return inheriting(int32s); }
function inheritingDoubles(): any[] { return inheriting(doubles); }
function inheritingStrings(): any[] { return inheriting(strings); }
function useInheritedElements(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  values("inherited element load", [t[0][n - 2], t[0][n + 2], t[0][n], t[1][n - 2], t[1][n + 2], t[1][n], t[2][n - 2], t[2][n + 2], t[2][n]]);
  values("inherited element load, any", [u[0][n - 2], u[0][n + 2], u[0][n], u[1][n - 2], u[1][n + 2], u[1][n], u[2][n - 2], u[2][n + 2], u[2][n]]);
  t[0][n - 2] = v.int32; t[1][n - 2] = v.half; t[2][n + 2] = v.text;
  results("inherited element push", [t[0].push(v.int32), t[1].push(v.half), t[2].push(v.text)], t);
  u[0][n - 2] = v.int32; u[1][n - 2] = v.half; u[2][n + 2] = v.text;
  results("inherited element push, any", [u[0].push(v.int32), u[1].push(v.half), u[2].push(v.text)], u);
}

const trace: string[] = [];
class Intercepted extends Array<unknown> {}
function intercepted(): Intercepted { const array = new Intercepted(); array.push(1, 2, 3); return array; }
function useIndexedAccessor(t: unknown[][], u: any[]): void {
  const n = t[0].length;
  values("indexed accessor load", [t[0][n], t[0][n - 1], t[0][n + 1], u[0][n], u[0][n - 1], u[0][n + 1]]);
  results("indexed accessor push", [t[0].push(v.int32), t[1].push(v.box)], t);
  t[2][n] = v.half; t[3][n + 1] = v.text; t[4][n - 2] = v.int32;
  contents("indexed accessor", t);
  results("indexed accessor push, any", [u[0].push(v.int32), u[1].push(v.box)], u);
  u[2][n] = v.half; u[3][n + 1] = v.text; u[4][n - 2] = v.int32;
  contents("indexed accessor, any", u);
  console.log("indexed accessor trace: " + trace.join(", "));
}
function useArraysAfterIndexedAccessor(t: unknown[][], u: any[]): void {
  const n = t[1].length;
  results("afterwards push", [t[0].push(v.int32), t[1].push(v.int32), t[2].push(v.half), t[3].push(v.box), t[4].push(v.text)], t);
  t[0][n] = v.box; t[1][n - 2] = v.half; t[2][n - 2] = v.nan; t[3][n + 40] = v.int32; t[4][n - 4] = v.text;
  contents("afterwards", t);
  results("afterwards push, any", [u[0].push(v.int32), u[1].push(v.int32), u[2].push(v.half), u[3].push(v.box), u[4].push(v.text)], u);
  u[0][n] = v.box; u[1][n - 2] = v.half; u[2][n - 2] = v.nan; u[3][n + 40] = v.int32; u[4][n - 4] = v.text;
  contents("afterwards, any", u);
  values("afterwards load", [t[1][n - 3], t[1][n + 40], t[2][n - 3], t[4][n - 4], u[1][n - 3], u[1][n + 40], u[2][n - 3], u[4][n - 4]]);
}

pushOntoEmptyLiterals(several(emptyLiteral, 8), several(emptyLiteral, 8));
pushOntoInt32s(several(int32s, 8), several(int32s, 8));
pushOntoDoubles(several(doubles, 8), several(doubles, 8));
pushOntoMixed(several(mixed, 8), several(mixed, 8));
pushOntoStrings(several(strings, 8), several(strings, 8));
pushOntoInt32Literals(several(int32Literal, 8), several(int32Literal, 8));
pushOntoDoubleLiterals(several(doubleLiteral, 8), several(doubleLiteral, 8));
pushOntoMixedLiterals(several(mixedLiteral, 8), several(mixedLiteral, 8));
pushOntoStringLiterals(several(stringLiteral, 8), several(stringLiteral, 8));
growFromEmpty(several(emptyLiteral, 4), several(emptyLiteral, 4));
pushNumbers(several(int32s, 5), several(doubles, 5), several(boxedNumbers, 5), each(int32Literal, int32Literal, doubleLiteral, doubleLiteral, doubleLiteral));
storeIntoEmptyLiterals(several(emptyLiteral, 19), several(emptyLiteral, 19));
storeIntoInt32s(several(int32s, 27), several(int32s, 27));
storeIntoDoubles(several(doubles, 27), several(doubles, 27));
storeIntoMixed(several(mixed, 27), several(mixed, 27));
storeIntoStrings(several(strings, 27), several(strings, 27));
storeIntoLiterals(each<unknown[]>(int32Literal, int32Literal, int32Literal, doubleLiteral, doubleLiteral, doubleLiteral, mixedLiteral, mixedLiteral, stringLiteral, stringLiteral), each<unknown[]>(int32Literal, int32Literal, int32Literal, doubleLiteral, doubleLiteral, doubleLiteral, mixedLiteral, mixedLiteral, stringLiteral, stringLiteral));
storeNumbers(several(int32s, 12), several(doubles, 12), several(boxedNumbers, 12));
loadFromEmptyLiterals(emptyLiteral(), emptyLiteral());
loadFromInt32s(withHole(int32s()), withHole(int32s()));
loadFromDoubles(withHole(doubles()), withHole(doubles()));
loadFromMixed(withHole(mixed()), withHole(mixed()));
loadFromStrings(withHole(strings()), withHole(strings()));
loadFromInt32sWithNamedProperties(withNamedProperties(withHole(int32s())), withNamedProperties(withHole(int32s())));
loadFromDoublesWithNamedProperties(withNamedProperties(withHole(doubles())), withNamedProperties(withHole(doubles())));
const wholeNumbers = "[1.5,2,-0,0,2147483647,2147483648,-2147483648,-2147483649,1e300,-7]";
loadWholeNumbersFromDoubles(JSON.parse(wholeNumbers), JSON.parse(wholeNumbers), JSON.parse(wholeNumbers));
loadNumbers(withHole(int32s()), withHole(doubles()), withHole(boxedNumbers()));
visitElements([withHole(int32s()), withHole(doubles()), withHole(mixed()), withHole(strings()), new Array(3)]);

for (const [name, make] of Object.entries(makers)) {
  for (const value of Object.values(v)) {
    grow(name + " grows by " + show(value), make(), value);
    growAny(name + " grows by " + show(value) + ", any", make(), value);
    for (const index of [1, 3, 5, 43, -1, 2 ** 32 - 2, 2 ** 32 - 1, 2 ** 32]) {
      const typed = make(), untyped = make();
      storeAt(typed, index, value);
      storeAtAny(untyped, index, value);
      console.log(name + "[" + index + "] = " + show(value) + " | " + describe(typed) + " | " + (describe(untyped) === describe(typed) ? "any agrees" : describe(untyped)) + " | " + show(loadAt(typed, index)) + " " + show(loadAtAny(untyped, index)));
    }
  }
}

const large = createLargeArray(), small = createSmallArray(), largeAny = createLargeArray(), smallAny = createSmallArray();
collectFull();
collectFull();
fillOldArrays(large, small, largeAny, smallAny);
collectYoung();
churn();
collectFull();
readOldArrays(large, small, largeAny, smallAny);

useFrozenArrays(locked(Object.freeze), locked(Object.freeze));
useSealedArrays(locked(Object.seal), locked(Object.seal));
useNonExtensibleArrays(locked(Object.preventExtensions), locked(Object.preventExtensions));
const fixLength = (array: any[]) => Object.defineProperty(array, "length", { writable: false });
useArraysOfFixedLength(locked(fixLength), locked(fixLength));
const constantLiterals = () => each<unknown[]>(constantInt32s, constantDoubles, constantStrings, constantInt32s, constantDoubles, constantStrings, constantInt32s, constantDoubles, constantStrings);
useConstantLiterals(constantLiterals(), constantLiterals());
contents("constant literal afterwards", constantLiterals().slice(0, 3));
const otherStorage = () => each(sparse, holesOnly, holesOnly, holesOnly, sparse, holesOnly, holesOnly, holesOnly, sparse, holesOnly);
useOtherStorage(otherStorage(), otherStorage());
const subclasses = () => each<unknown[]>(plain, plain, loud, loud, plain, plain, loud, loud, plain);
useSubclasses(subclasses(), subclasses());
useInheritedElements(each(inheritingInt32s, inheritingDoubles, inheritingStrings), each(inheritingInt32s, inheritingDoubles, inheritingStrings));
pushWithLiveDoubles(each<unknown[]>(doubles, doubles, doubles, doubleLiteral, int32s, doubles), d.half);
pushNumbersWithLiveDoubles(each(doubles, doubles, doubles, int32s, boxedNumbers), d.half);
storeWithLiveDoubles(each(doubles, doubles, doubles, doubles, int32s, doubles), d.half);
storeNumbersWithLiveDoubles(each(boxedNumbers, boxedNumbers, boxedNumbers, boxedNumbers, doubles, int32s), d.half);
loadWithLiveDoubles(JSON.parse("[1.5,2,-0]"), withHole(doubles()), inheritingDoubles(), d.half);

Object.defineProperty(Intercepted.prototype, 3, { get() { trace.push("get"); return "from the getter"; }, set(value: unknown) { trace.push("set " + show(value)); }, configurable: true });
useIndexedAccessor(several(intercepted, 5), several(intercepted, 5));
useArraysAfterIndexedAccessor(each(emptyLiteral, int32s, doubles, mixed, strings), each(emptyLiteral, int32s, doubles, mixed, strings));
