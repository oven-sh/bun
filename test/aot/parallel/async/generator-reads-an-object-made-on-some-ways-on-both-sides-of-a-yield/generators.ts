type Word = "red" | "green" | "blue" | "";
const words: Word[] = ["red", "green", "blue", ""];
class Box {
  d: number;
  w: number;
  u: number;
  on: boolean;
  tag: Word;
  name: string;
  some: number | undefined;
  ratio: number | null;
  flagged: boolean | undefined;
  label: string | undefined;
  constructor(
    public n: number,
    public next: Box | null,
  ) {
    this.d = n * 0.5;
    this.w = n * 4294967296 + 7;
    this.u = n >>> 0;
    this.on = (n & 1) === 0;
    this.tag = words[n & 3];
    this.name = "b";
    this.some = n & 2 ? n : undefined;
    this.ratio = n & 4 ? n * 0.25 : null;
    this.flagged = n & 8 ? (n & 1) === 1 : undefined;
    this.label = n & 16 ? "l" : undefined;
  }
}
abstract class Shape {
  constructor(public id: number) {}
  abstract area(k: number): number;
  get twice(): number {
    return this.id * 2;
  }
  grown(by: number): Shape {
    this.id = (this.id + by) | 0;
    return this;
  }
}
class Square extends Shape {
  constructor(
    id: number,
    public side: number,
  ) {
    super(id);
  }
  area(k: number): number {
    return (Math.imul(this.side, this.side) + k) | 0;
  }
}
class Disc extends Shape {
  constructor(
    id: number,
    public r: number,
  ) {
    super(id);
  }
  area(k: number): number {
    return this.r * 3.25 + k;
  }
}
class Strip extends Shape {
  constructor(
    id: number,
    public from: Box,
    public label: string,
  ) {
    super(id);
  }
  area(k: number): number {
    return (this.from.n + this.label.length + k) | 0;
  }
  get twice(): number {
    return this.from.w;
  }
}
function shapeOf(x: number, box: Box): Shape {
  tick();
  return x % 3 === 0 ? new Square(x, x & 255) : x % 3 === 1 || x % 3 === -1 ? new Disc(x, x * 0.5) : new Strip(x, box, "s" + (x & 3));
}
const odd = new Float64Array(
  new BigUint64Array([0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffa000000000000n, 0x7ff8000000000000n, 0x7ff0000000000000n, 0x8000000000000000n, 0xfffe000000000001n]).buffer,
);
let calls = 0;
let sink = 0;
function tick(): void {
  if (++calls % 977 === 0)
    try {
      throw calls;
    } catch {}
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : value === Infinity ? 19 : value === -Infinity ? 23 : ((value * 1000) | 0) ^ ((value / 4294967296) | 0);
    case "boolean":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    case "undefined":
      return 7;
    default:
      if (value === null) return 11;
      if (value instanceof Box) return foldBox(value) ^ (value.next === null ? 0 : Math.imul(foldBox(value.next), 31));
      if (value instanceof Shape) return value.id ^ fold(value.area(1)) ^ fold(value.twice);
      if (value instanceof Map) {
        let sum = value.size;
        for (const [key, held] of value) sum = (Math.imul(sum, 31) + fold(key) + fold(held)) | 0;
        return sum;
      }
      let sum = 0;
      for (let i = 0; i < value.length; i++) sum = (Math.imul(sum, 31) + fold(value[i])) | 0;
      return sum;
  }
}
function foldBox(box: Box): number {
  return box.n ^ fold(box.d) ^ fold(box.w) ^ fold(box.u) ^ fold(box.on) ^ fold(box.tag) ^ fold(box.name) ^ fold(box.some) ^ fold(box.ratio) ^ fold(box.flagged) ^ fold(box.label);
}
function note(value: any): void {
  tick();
  sink = (Math.imul(sink, 31) + fold(value)) | 0;
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueWide(x: number, y: number): number {
  tick();
  return (x % 4503599627370496) + y;
}
function opaqueDouble(x: number, y: number): number {
  tick();
  return x * 0.75 + y;
}
function opaqueText(x: string, y: number): string {
  tick();
  return (x + (y & 7)).slice(-5);
}
function opaqueWord(x: number): Word {
  tick();
  return words[x & 3];
}
function opaqueBox(x: Box, y: number): Box {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
function opaqueMaybe(x: number): number | undefined {
  tick();
  return x & 1 ? undefined : x;
}
function opaqueAny(x: any): any {
  tick();
  return x;
}
function mayThrow(x: number): number {
  tick();
  switch (x & 31) {
    case 5:
      throw x;
    case 11:
      throw new Box(x, null);
    case 17:
      throw String(x & 255);
    case 23:
      throw x * 0.5;
  }
  return (x + 1) | 0;
}
function throwsFromBelow(x: number, deeper: number): number {
  const i0 = x ^ 21845, i1 = (x + 77) | 0, i2 = Math.imul(x, 31), i3 = x >> 1, i4 = ~x, i5 = (x - 9) | 0, d0 = x * 0.5, d1 = x + 0.25; // prettier-ignore
  const below = deeper > 0 ? throwsFromBelow(x, deeper - 1) : mayThrow(x);
  return (below ^ i0 ^ i1 ^ i2 ^ i3 ^ i4 ^ i5 ^ fold(d0) ^ fold(d1)) | 0;
}
function scribble(x: number, deeper: number): number {
  const i0 = ~x, i1 = x ^ -1431655766, i2 = (x - 2147483647) | 0, i3 = x | -65536, i4 = -x | 0, i5 = x ^ 1431655765; // prettier-ignore
  const w0 = x * 4294967296 - 1, w1 = -9007199254740991 + x, w2 = x * 1099511627776 + 4294967295; // prettier-ignore
  const d0 = x * -1.5e300, d1 = 0 / (x & 1), d2 = -1 / (x + 0.5), d3 = x + 1e-300; // prettier-ignore
  const b0 = new Box(x, null), t0 = String(x), f0 = x > 3, f1 = x < 3; // prettier-ignore
  const below = deeper > 0 ? scribble(x + 1, deeper - 1) : opaqueInt(x, 1);
  return (below ^ i0 ^ i1 ^ i2 ^ i3 ^ i4 ^ i5 ^ fold(w0) ^ fold(w1) ^ fold(w2) ^ fold(d0) ^ fold(d1) ^ fold(d2) ^ fold(d3) ^ b0.n ^ t0.length ^ fold(f0) ^ fold(f1)) | 0;
}
async function later(x: number): Promise<number> {
  tick();
  return (x + 1) | 0;
}
async function laterOrNever(x: number): Promise<number> {
  tick();
  if ((x & 15) === 9) throw x;
  return (x + 1) | 0;
}
function* some(count: number): Generator<number, number, number> {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + (yield i)) | 0;
  return sum;
}
async function* someLater(count: number): AsyncGenerator<number, number, unknown> {
  for (let i = 0; i < count; i++) yield await later(i);
  return count;
}
function drained(steps: Generator<number, number, number>, stop: number): number {
  let sum = 0;
  try {
    let step = steps.next(0);
    for (let turn = 0; !step.done; turn++) {
      sum = (Math.imul(sum, 31) + step.value) | 0;
      step = turn !== stop ? steps.next(sum & 7) : stop & 1 ? steps.return(sum) : steps.throw(sum & 255);
    }
    return (Math.imul(sum, 31) + step.value) | 0;
  } catch (thrown) {
    return (sum ^ fold(thrown)) | 0;
  }
}
async function drainedLater(steps: AsyncGenerator<number, number, number>, stop: number): Promise<number> {
  let sum = 0;
  try {
    let step = await steps.next(0);
    for (let turn = 0; !step.done; turn++) {
      sum = (Math.imul(sum, 31) + step.value) | 0;
      step = await (turn !== stop ? steps.next(sum & 7) : stop & 1 ? steps.return(sum) : steps.throw(sum & 255));
    }
    return (Math.imul(sum, 31) + step.value) | 0;
  } catch (thrown) {
    return (sum ^ fold(thrown)) | 0;
  }
}
function settled(result: PromiseSettledResult<number>): number {
  return result.status === "fulfilled" ? result.value : fold(result.reason) + 1;
}
function mix0(p0: string, p1: boolean, p2: boolean, p3: number | null, p4: number, p5: Box, p6: number | undefined, p7: Word, p8: boolean): number {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19)) | 0;
  return all >>> 0;
}
function mix1(p0: boolean, p1: number, p2: number | null, p3: number, p4: Box, p5: number | undefined, p6: number, p7: Box | null, p8: string, p9: number, p10: number | undefined, p11: number, p12: number, p13: Box | null): number {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19) ^ Math.imul(fold(p9), 21) ^ Math.imul(fold(p10), 23) ^ Math.imul(fold(p11), 25) ^ Math.imul(fold(p12), 27) ^ Math.imul(fold(p13), 29)) | 0;
  return all * 0.125;
}
function mix2(p0: number | undefined, p1: number | null, p2: Word): number {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7)) | 0;
  return all;
}
function mix3(p0: number, p1: string, p2: Word, p3: number, p4: Box | null, p5: Word, p6: number | undefined, p7: boolean, p8: number | null): number | null {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19)) | 0;
  return all & 1 ? all * 0.5 : null;
}
function mix4(p0: number, p1: string, p2: Word, p3: number, p4: number, p5: Box, p6: number, p7: Word, p8: Word): Word {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19)) | 0;
  return words[all & 3];
}
function f0(a: number, b: number): number {
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v0: number = (a * 1 + b * 7 + 2) | 0;
let v1: number = (a * 2 + b * 7 + 8) | 0;
let v2: number | undefined = (a + 2) & 1 ? a : undefined;
let v3: Shape = shapeOf(a + 3, new Box(b, null));
let v4: Box = new Box(b + 4, null);
let v5: Box = new Box(b + 5, null);
let v6: Box = new Box(b + 6, null);
let v7: string | undefined = (a + 7) & 1 ? String(b) : undefined;
let v8: number | undefined = (a + 8) & 1 ? a : undefined;
let v9: string = String((a + 9) & 31);
let v10: number = a * 10.5 + b / 4;
let v11: number | undefined = (a + 11) & 1 ? a : undefined;
let v12: Box | null = (a + 12) & 1 ? new Box(a, null) : null;
let v13: number = a * 65536 + b + 13;
let v14: number = (a * 15 + b * 3 + 34) | 0;
let v15: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
let v16: Box[] = [new Box(a, null), new Box(b, null), new Box(16, null), new Box(a + b, null)];
let v17: string = String((a + 17) & 31);
let v18: number = (a * 19 + b * 7 + 21) | 0;
let v19: Box = new Box(b + 19, null);
let v20: Box | null = (a + 20) & 1 ? new Box(a, null) : null;
let v21: Shape = shapeOf(a + 21, new Box(b, null));
let v22: Uint16Array = new Uint16Array([a, b, -a, 7, a ^ b, 300 - b, -1, b * 1000]);
let v23: string = String((a + 23) & 31);
let v24: any = new Box(a, null);
let v25: number = (a * 26 + b * 2 + 48) | 0;
let v26: Shape = shapeOf(a + 26, new Box(b, null));
let v27: any = undefined;
let v28: Map<number, number> = new Map([[a & 7, b], [4, a * 0.5]]);
let v29: Shape = shapeOf(a + 29, new Box(b, null));
let v30: boolean | undefined = (a + 30) & 1 ? a > b : undefined;
let v31: number = (a * 32 - b) >>> 0;
let v32: Word = words[(a + 32) & 3];
let v33: number = a * 33.5 + b / 4;
let v34: Word = words[(a + 34) & 3];
let v35: Box | null = (a + 35) & 1 ? new Box(a, null) : null;
let v36: number | null = (a + 36) & 1 ? a * 0.5 : null;
let v37: string | undefined = (a + 37) & 1 ? String(b) : undefined;
let v38: Box[] = [new Box(a, null), new Box(b, null), new Box(38, null), new Box(a + b, null)];
let v39: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
let v40: number = (a * 41 + b * 4 + 6) | 0;
let v41: Shape = shapeOf(a + 41, new Box(b, null));
let v42: Int32Array = new Int32Array([a, b, -a, 7, a ^ b, 300 - b, -1, b * 1000]);
let v43: number = a * 4294967296;
let v44: number = (a * 45 + b * 4 + 46) | 0;
let v45: Map<number, number> = new Map([[a & 7, b], [5, a * 0.5]]);
let v46: Box = new Box(b + 46, null);
let v47: Box | null = (a + 47) & 1 ? new Box(a, null) : null;
v13 = -9007199254740991;
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ v14 ^ fold(v15) ^ fold(v16) ^ fold(v17) ^ v18 ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ fold(v23) ^ fold(v24) ^ v25 ^ fold(v26) ^ fold(v27) ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ fold(v32) ^ fold(v33) ^ fold(v34) ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ fold(v38) ^ fold(v39) ^ v40 ^ fold(v41) ^ fold(v42) ^ fold(v43) ^ v44 ^ fold(v45) ^ fold(v46) ^ fold(v47)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 400; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    try {
      hash = (Math.imul(hash, 31) + (a => f0(a, b))(i)) | 0;
    } catch (thrown) {
      hash = (hash ^ fold(thrown)) | 0;
    }
  }
  console.log("f0 " + (hash >>> 0).toString(16));
  console.log("f0 on the way " + (sink >>> 0).toString(16));
}
function f1(a: number, b: number, v0: number, v1: number, v2: number, v3: number, v4: number, v5: number, v6: number, v7: number, v8: number, v9: number, v10: number, v11: number, v12: number, v13: number, v14: number, v15: number, v16: number, v17: number, v18: number, v19: number, v20: number, v21: number, v22: number, v23: number): number {
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v24: number = (a * 25 + b * 8 + 4) | 0;
let v25: number = a * 25.5 + b / 4;
let v26: number = (a * 27 + b * 1 + 33) | 0;
  console.log("f1 " + (hash >>> 0).toString(16));
  console.log("f1 on the way " + (sink >>> 0).toString(16));
}
function* f2(a: number, b: number, v0: number, v1: number, v2: any, v3: number): Generator<number, number, number> {
if ((a & 15) === 3) return b;
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v4: Box | null = (a + 4) & 1 ? new Box(a, null) : null;
let v5: boolean = ((a + 5) & 1) === 0;
let v6: number = (a * 7 + b * 7 + 9) | 0;
let v7: number = a * 1099511627776 + b + 7;
let v8: boolean | undefined = (a + 8) & 1 ? a > b : undefined;
let v9: number | undefined = (a + 9) & 1 ? a : undefined;
let v10: boolean = ((a + 10) & 1) === 0;
let v11: number = (a * 12 + b * 3 + 42) | 0;
const closure0 = (x: number): number => {
 v6 = (v6 + x) | 0;
 return v6 ^ v11;
 }
;
const closure1 = (x: number): number => {
 v6 = (v6 + x) | 0;
 return v6 ^ v3;
 }
;
v2 = (words[1] as Word);
yield v6;
for (let c0 = 0;
 c0 < 4 && (v11 * 0.5 + v11 > v7 / 3 - v1 || c0 < 1);
 c0++) {
v6 = Math.max(v11, v11);
v0 = opaqueInt(v3, c0);
}
switch ((v11 & 127) - 8) {
case 26: case 37: case 13: case 57: v1 = ((v0 >>> 0) / 2) | 0;
 case 36: case 33: case 43: case 1: v11 = odd[((v11 << 3) >>> 0) % 8] | 0;
 break;
case 24: case 60: case 0: case 8: switch (v2 as any) {
case 51: case 15: case 52: case 0: case 58: case 50: case 49: if (spare.n > v3) {
v11 = ((yield v3) + v0) | 0;
try {
v9 = opaqueMaybe(v6);
v7 = v7 > 4503599627370496 || v7 < -4503599627370496 ? v1 : v7 * 2;
v1 = (v1 >>> v11) | 0;
 if (v11 === v1 && (v4 as Box | null) !== null) return v1;
v7 = -v7;
}
 finally {
v11 = opaqueAny(v6 & 7 ? spare : null).n | 0;
v3 = v11 >> (v3 & 31);
v8 = (v8 as boolean | undefined);
}
v5 = v10 && v11 > 3;
if ((v7 | 0) >= v3 && spare === spare) return v11;
}
 else {
v6 = f0(v0 & 63, v0 & 63);
let c1 = 2;
 do {
v10 = (v8 as boolean | undefined) ?? v10;
}
 while (--c1 > 0 && (v1 < v11));
const k2: number = v3, k3: number = v0, k4: number = v6, k5: number = v11, k6: number = v1;
v1 = k6;
v0 = k3;
v6 = k6;
v11 = k3;
v3 = k4;
switch (words[v3 & 3]) {
 case "red": v6 = v7 | 0;
v9 = spare.some;
 break;
 case "green": v9 = v5 ? v3 : undefined;
v5 = (v8 as boolean | undefined) ?? v10;
v10 = (v8 as boolean | undefined) ?? v10;
v6 = -v3 | 0;
 case "blue": v0 = Math.clz32(v0);
 break;
 default: v2 = (v4 as Box | null);
v9 = 0;
v6 = ~v6;
v0 = v6 << v0;
 }
}
for (let c7 = 0;
 c7 < 2;
 c7++) {
v7 = (v6 >>> 0) * 65537;
const k8: number = v6;
v6 = v0;
v0 = v1;
v1 = v11;
v11 = v3;
v3 = k8;
switch (v6 as number) {
case 3: v10 = v5 && v6 > 3;
 break;
}
}
v2 = (words[1] as Word);
 break;
case 57: case 25: case 24: case 34: case 27: case 6: case 1: v2 = v11;
 break;
case 46: case 63: case 33: case 22: case 41: case 11: v5 = v6 < v6;
  default: v4 = v10 ? (v4 as Box | null) : opaqueBox(spare, v3);
}
v4 = null as Box | null;
v1 = (v6 + (yield v0) + v1 + (yield v6)) | 0;
if ((v7 & 255) === 3) {
v8 = v10 ? v0 > v0 : undefined;
v0 = v3;
v4 = (spare.next as Box | null)?.next ?? null;
v9 = opaqueMaybe(v0);
v10 = v5;
v2 = v5 ? v3 : "t";
v3 = v6;
v6 = v5 ? v1 : v1;
v5 = spare.on;
v1 = v0;
v11 = v6;
v7 = (v7 * 3) % 9007199254740991;
}
 else {
v0 = v11;
v1 = v11;
v10 = v5;
v7 = v1 * 3;
v8 = spare.flagged;
v11 = v1;
v4 = null as Box | null;
v9 = v6;
v2 = (v0 >>> 0);
v6 = v0;
v3 = v6;
v5 = v10;
}
 break;
}
return (v0 ^ v1 ^ fold(v2) ^ v3 ^ fold(v4) ^ fold(v5) ^ v6 ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ v11) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 21; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    hash = (Math.imul(hash, 31) + drained((a => f2(a, b, (a * 1 + b * 1 + 3) | 0, (a * 2 + b * 5 + 44) | 0, null, (a * 4 + b * 1 + 42) | 0))(i), i % 5 ? -1 : (i >> 2) & 15)) | 0;
  }
  console.log("f2 " + (hash >>> 0).toString(16));
  console.log("f2 on the way " + (sink >>> 0).toString(16));
}
function f3(a: number, b: number, v0: number, v1: number): number {
if (b > 60) return (a + b) | 0;
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v2: number | undefined = (a + 2) & 1 ? a : undefined;
let v3: boolean | undefined = (a + 3) & 1 ? a > b : undefined;
let v4: number | null = (a + 4) & 1 ? a * 0.5 : null;
let v5: number | null = (a + 5) & 1 ? a * 0.5 : null;
if (v1 & 2) {
for (const each of [v1, v0, 2]) {
v1 = (v0 + each) | 0;
switch (v1 & 15) {
case 0: v2 = opaqueMaybe(v0);
 break;
case 1: v0 = (v1 - v0) | 0;
v2 = spare.some;
 break;
case 2: v3 = undefined as boolean | undefined;
 case 3: v5 = (v5 as number | null) === null ? v1 : (v5 as number | null)! * 0.5;
v3 = spare.flagged;
v5 = v0;
 break;
 }
}
v1 = ~v0;
v3 = (v1 > 0);
v5 = spare.ratio;
}
 else {
v1 = "t".charCodeAt(v0 & 3) | 0;
}
v0 = Math.max(v1, v1);
v3 = (v3 as boolean | undefined);
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 100; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    try {
      hash = (Math.imul(hash, 31) + (a => f3(a, b, (a * 1 + b * 7 + 33) | 0, (a * 2 + b * 1 + 12) | 0))(i)) | 0;
    } catch (thrown) {
      hash = (hash ^ fold(thrown)) | 0;
    }
  }
  console.log("f3 " + (hash >>> 0).toString(16));
  console.log("f3 on the way " + (sink >>> 0).toString(16));
}

export {};
