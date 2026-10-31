// 48 (0) of int+double . asyncGenerator 120 (4) of int+maybeBox+text+boxes+double+table+shape+box . async 12 (0) of int+flag+shape+text+word+maybeText+maybeFlag+memory+maybeDouble . 24 (7) of int+double+table+shape+text+boxes+maybeBox+word+any+wide+memory
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

function mix0(p0: Word, p1: number | undefined, p2: number | undefined): number {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7)) | 0;
  return all >>> 0;
}
function mix1(p0: number, p1: number, p2: number, p3: Word, p4: Word, p5: number, p6: Word, p7: boolean, p8: number | undefined): string {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19)) | 0;
  return String(all & 1023);
}
function mix2(p0: string, p1: Box, p2: Word, p3: Box, p4: number | null, p5: number, p6: Word, p7: number, p8: number, p9: number | null, p10: number | undefined, p11: Box, p12: number, p13: boolean): number | null {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19) ^ Math.imul(fold(p9), 21) ^ Math.imul(fold(p10), 23) ^ Math.imul(fold(p11), 25) ^ Math.imul(fold(p12), 27) ^ Math.imul(fold(p13), 29)) | 0;
  return all & 1 ? all * 0.5 : null;
}
function mix3(p0: number, p1: boolean, p2: Box | null, p3: number, p4: number, p5: Box | null, p6: number | null, p7: number, p8: number): number | null {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19)) | 0;
  return all & 1 ? all * 0.5 : null;
}
function mix4(p0: number, p1: number, p2: number, p3: number, p4: string, p5: number, p6: number | null, p7: number, p8: boolean, p9: number | null, p10: number, p11: number, p12: number, p13: number | null): string {
  tick();
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19) ^ Math.imul(fold(p9), 21) ^ Math.imul(fold(p10), 23) ^ Math.imul(fold(p11), 25) ^ Math.imul(fold(p12), 27) ^ Math.imul(fold(p13), 29)) | 0;
  return String(all & 1023);
}
function f0(a: number, b: number): number {
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v0: number = (a * 1 + b * 7 + 44) | 0;
let v1: number = (a * 2 + b * 7 + 20) | 0;
let v2: number = (a * 3 + b * 6 + 34) | 0;
let v3: number = a * 3.5 + b / 4;
let v4: number = a * 4.5 + b / 4;
let v5: number = a * 5.5 + b / 4;
let v6: number = a * 6.5 + b / 4;
let v7: number = a * 7.5 + b / 4;
let v8: number = (a * 9 + b * 4 + 40) | 0;
let v9: number = a * 9.5 + b / 4;
let v10: number = a * 10.5 + b / 4;
let v11: number = a * 11.5 + b / 4;
let v12: number = a * 12.5 + b / 4;
let v13: number = a * 13.5 + b / 4;
let v14: number = a * 14.5 + b / 4;
let v15: number = a * 15.5 + b / 4;
let v16: number = a * 16.5 + b / 4;
let v17: number = (a * 18 + b * 6 + 49) | 0;
let v18: number = a * 18.5 + b / 4;
let v19: number = a * 19.5 + b / 4;
let v20: number = a * 20.5 + b / 4;
let v21: number = a * 21.5 + b / 4;
let v22: number = a * 22.5 + b / 4;
let v23: number = a * 23.5 + b / 4;
let v24: number = a * 24.5 + b / 4;
let v25: number = a * 25.5 + b / 4;
let v26: number = a * 26.5 + b / 4;
let v27: number = (a * 28 + b * 1 + 20) | 0;
let v28: number = a * 28.5 + b / 4;
let v29: number = a * 29.5 + b / 4;
let v30: number = a * 30.5 + b / 4;
let v31: number = a * 31.5 + b / 4;
let v32: number = a * 32.5 + b / 4;
let v33: number = a * 33.5 + b / 4;
let v34: number = a * 34.5 + b / 4;
let v35: number = a * 35.5 + b / 4;
let v36: number = a * 36.5 + b / 4;
let v37: number = a * 37.5 + b / 4;
let v38: number = a * 38.5 + b / 4;
let v39: number = a * 39.5 + b / 4;
let v40: number = a * 40.5 + b / 4;
let v41: number = a * 41.5 + b / 4;
let v42: number = a * 42.5 + b / 4;
let v43: number = a * 43.5 + b / 4;
let v44: number = a * 44.5 + b / 4;
let v45: number = a * 45.5 + b / 4;
let v46: number = a * 46.5 + b / 4;
let v47: number = a * 47.5 + b / 4;
const closure0 = (x: number): number => {
 v0 = (v0 + x) | 0;
 return v0 ^ v17;
 }
;
const closure1 = (x: number): number => {
 v17 = (v17 + x) | 0;
 return v17 ^ v2;
 }
;
let c0 = 4;
 L0: while (c0-- > 0) {
L1: {
const k2: number = v34, k3: number = v38, k4: number = v29;
v29 = k2;
v34 = k3;
v38 = k2;
L5: for (let c5 = 0;
 c5 < 2;
 c5++) {
v29 = -v6;
for (let c6 = 0;
 c6 < 4;
 c6++) {
v35 = (v1 & 7) / (v0 & 1);
const k7: number = v3;
v3 = v46;
v46 = v28;
v28 = v47;
v47 = v20;
v20 = v24;
v24 = v36;
v36 = v31;
v31 = v37;
v37 = k7;
switch (v27 as number) {
case 2: v17 = (spare.next as Box | null) === null ? v27 : v2;
 break;
case 5: v18 = v41;
v13 = v40;
v0 = v27;
v9 = v0 & 3 ? v16 : -0;
v47 = v39;
 break;
case 0: v47 = v41;
v37 = v43;
v40 = v38;
v11 = v42;
v32 = v22 !== v22 ? v1 : v22;
v34 = v16;
v15 = v20;
v9 = v2 / ((v1 & 7) + 1);
v17 = v8;
v35 = v41;
v44 = v4;
v16 = v31;
 break;
}
}
}
 if (v8 & 2) break L1;
v22 = Math.floor(v35) + 0.25;
for (const each of [v8, v0, 1]) {
v8 = (v17 + each) | 0;
v35 = v28 * 0;
if (spare.name === spare.name) {
v41 = v1 / 3;
}
 else {
if (v2 < v8) continue L0;
v22 = opaqueDouble(v37, v0);
v20 = v0 / ((v0 & 7) + 1);
}
}
}
const k8: number = v29;
v29 = v10;
v10 = k8;
 if (v1 < 0 || v2 < 0) break;
}
for (let c9 = 0;
 c9 < 2 && ((spare.next as Box | null) !== null || c9 < 1);
 c9++, v13 = v11, v11 = v28, v28 = v39, v39 = v3, v3 = v37, v37 = v26, v26 = v32, v32 = v41, v41 = v38, v38 = v36, v36 = v45, v45 = v25, v25 = v16, v16 = v21, v21 = v15, v15 = v14) {
v26 = v1 / 3;
}
return (v0 ^ v1 ^ v2 ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ v8 ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ v17 ^ fold(v18) ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ fold(v23) ^ fold(v24) ^ fold(v25) ^ fold(v26) ^ v27 ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ fold(v32) ^ fold(v33) ^ fold(v34) ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ fold(v38) ^ fold(v39) ^ fold(v40) ^ fold(v41) ^ fold(v42) ^ fold(v43) ^ fold(v44) ^ fold(v45) ^ fold(v46) ^ fold(v47)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 20; i += 1) {
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

async function* f1(a: number, b: number, v0: number, v1: number, v2: Box | null, v3: string): AsyncGenerator<number, number, number> {
if ((a & 15) === 3) return b;
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v4: Box[] = [new Box(a, null), new Box(b, null), new Box(4, null), new Box(a + b, null)];
let v5: string = String((a + 5) & 31);
let v6: number = (a * 7 + b * 0 + 36) | 0;
let v7: number = a * 7.5 + b / 4;
let v8: number = (a * 9 + b * 6 + 34) | 0;
let v9: string = String((a + 9) & 31);
let v10: number = (a * 11 + b * 5 + 48) | 0;
let v11: string = String((a + 11) & 31);
let v12: number = (a * 13 + b * 6 + 18) | 0;
let v13: number = (a * 14 + b * 5 + 46) | 0;
let v14: number = a * 14.5 + b / 4;
let v15: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
let v16: string = String((a + 16) & 31);
let v17: Shape = shapeOf(a + 17, new Box(b, null));
let v18: Box[] = [new Box(a, null), new Box(b, null), new Box(18, null), new Box(a + b, null)];
let v19: number = (a * 20 + b * 7 + 11) | 0;
let v20: number = a * 20.5 + b / 4;
let v21: Box[] = [new Box(a, null), new Box(b, null), new Box(21, null), new Box(a + b, null)];
let v22: number = a * 22.5 + b / 4;
let v23: Box[] = [new Box(a, null), new Box(b, null), new Box(23, null), new Box(a + b, null)];
let v24: number = a * 24.5 + b / 4;
let v25: number = a * 25.5 + b / 4;
let v26: string = String((a + 26) & 31);
let v27: number = a * 27.5 + b / 4;
let v28: Shape = shapeOf(a + 28, new Box(b, null));
let v29: number = (a * 30 + b * 8 + 45) | 0;
let v30: number = (a * 31 + b * 5 + 26) | 0;
let v31: Box | null = (a + 31) & 1 ? new Box(a, null) : null;
let v32: string = String((a + 32) & 31);
let v33: Shape = shapeOf(a + 33, new Box(b, null));
let v34: number = (a * 35 + b * 8 + 12) | 0;
let v35: Box = new Box(b + 35, null);
let v36: Map<number, number> = new Map([[a & 7, b], [4, a * 0.5]]);
let v37: Box[] = [new Box(a, null), new Box(b, null), new Box(37, null), new Box(a + b, null)];
let v38: string = String((a + 38) & 31);
let v39: string = String((a + 39) & 31);
let v40: number = a * 40.5 + b / 4;
let v41: Box[] = [new Box(a, null), new Box(b, null), new Box(41, null), new Box(a + b, null)];
let v42: number = a * 42.5 + b / 4;
let v43: Map<number, number> = new Map([[a & 7, b], [3, a * 0.5]]);
let v44: Shape = shapeOf(a + 44, new Box(b, null));
let v45: number = (a * 46 + b * 6 + 44) | 0;
let v46: number = a * 46.5 + b / 4;
let v47: number = (a * 48 + b * 2 + 12) | 0;
let v48: string = String((a + 48) & 31);
let v49: Map<number, number> = new Map([[a & 7, b], [1, a * 0.5]]);
let v50: Shape = shapeOf(a + 50, new Box(b, null));
let v51: Shape = shapeOf(a + 51, new Box(b, null));
let v52: Box[] = [new Box(a, null), new Box(b, null), new Box(52, null), new Box(a + b, null)];
let v53: Map<number, number> = new Map([[a & 7, b], [5, a * 0.5]]);
let v54: Map<number, number> = new Map([[a & 7, b], [6, a * 0.5]]);
let v55: Box = new Box(b + 55, null);
let v56: Shape = shapeOf(a + 56, new Box(b, null));
let v57: Shape = shapeOf(a + 57, new Box(b, null));
let v58: Box | null = (a + 58) & 1 ? new Box(a, null) : null;
let v59: number = (a * 60 + b * 8 + 28) | 0;
let v60: Box[] = [new Box(a, null), new Box(b, null), new Box(60, null), new Box(a + b, null)];
let v61: number = (a * 62 + b * 1 + 4) | 0;
let v62: number = (a * 63 + b * 3 + 6) | 0;
let v63: string = String((a + 63) & 31);
let v64: number = a * 64.5 + b / 4;
let v65: number = a * 65.5 + b / 4;
let v66: Box | null = (a + 66) & 1 ? new Box(a, null) : null;
let v67: number = (a * 68 + b * 1 + 15) | 0;
let v68: number = (a * 69 + b * 7 + 20) | 0;
let v69: number = (a * 70 + b * 5 + 5) | 0;
let v70: string = String((a + 70) & 31);
let v71: string = String((a + 71) & 31);
let v72: Shape = shapeOf(a + 72, new Box(b, null));
let v73: Shape = shapeOf(a + 73, new Box(b, null));
let v74: string = String((a + 74) & 31);
let v75: number = a * 75.5 + b / 4;
let v76: string = String((a + 76) & 31);
let v77: Shape = shapeOf(a + 77, new Box(b, null));
let v78: Shape = shapeOf(a + 78, new Box(b, null));
let v79: Shape = shapeOf(a + 79, new Box(b, null));
let v80: Shape = shapeOf(a + 80, new Box(b, null));
let v81: Box | null = (a + 81) & 1 ? new Box(a, null) : null;
let v82: Box[] = [new Box(a, null), new Box(b, null), new Box(82, null), new Box(a + b, null)];
let v83: Shape = shapeOf(a + 83, new Box(b, null));
let v84: Box | null = (a + 84) & 1 ? new Box(a, null) : null;
let v85: number = (a * 86 + b * 4 + 49) | 0;
let v86: number = (a * 87 + b * 3 + 28) | 0;
let v87: Shape = shapeOf(a + 87, new Box(b, null));
let v88: number = (a * 89 + b * 2 + 46) | 0;
let v89: number = (a * 90 + b * 3 + 14) | 0;
let v90: Shape = shapeOf(a + 90, new Box(b, null));
let v91: Shape = shapeOf(a + 91, new Box(b, null));
let v92: Shape = shapeOf(a + 92, new Box(b, null));
let v93: number = (a * 94 + b * 8 + 33) | 0;
let v94: Shape = shapeOf(a + 94, new Box(b, null));
let v95: number = (a * 96 + b * 2 + 3) | 0;
let v96: number = (a * 97 + b * 0 + 32) | 0;
let v97: Box = new Box(b + 97, null);
let v98: Shape = shapeOf(a + 98, new Box(b, null));
let v99: number = (a * 100 + b * 1 + 4) | 0;
let v100: number = a * 100.5 + b / 4;
let v101: number = a * 101.5 + b / 4;
let v102: Shape = shapeOf(a + 102, new Box(b, null));
let v103: string = String((a + 103) & 31);
let v104: string = String((a + 104) & 31);
let v105: number = (a * 106 + b * 8 + 14) | 0;
let v106: Shape = shapeOf(a + 106, new Box(b, null));
let v107: Shape = shapeOf(a + 107, new Box(b, null));
let v108: number = (a * 109 + b * 8 + 36) | 0;
let v109: Box = new Box(b + 109, null);
let v110: Shape = shapeOf(a + 110, new Box(b, null));
let v111: string = String((a + 111) & 31);
let v112: Shape = shapeOf(a + 112, new Box(b, null));
let v113: Box | null = (a + 113) & 1 ? new Box(a, null) : null;
let v114: Map<number, number> = new Map([[a & 7, b], [2, a * 0.5]]);
let v115: number = (a * 116 + b * 1 + 26) | 0;
let v116: Shape = shapeOf(a + 116, new Box(b, null));
let v117: Map<number, number> = new Map([[a & 7, b], [5, a * 0.5]]);
let v118: Box | null = (a + 118) & 1 ? new Box(a, null) : null;
let v119: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
const closure0 = (x: number): number => {
 v45 = (v45 + x) | 0;
 return v45 ^ v67;
 }
;
switch (v68 & 3) {
 case 0: if ((a & 3) === 1) v61 = (yield* f1(a >> 2, b, v6, v86, v61 & 1 ? v35 : null, v3));
try {
L0: for (let c0 = 0;
 c0 < 4;
 c0++) {
try {
({
 n: v61, on: sunk }
 = v109);
v50 = shapeOf(v69, v109);
v58 = (v113 as Box | null)?.next ?? null;
}
 catch (thrown) {
note(thrown);
v69 = odd[v29 & 7] | 0;
v73 = v6 & 1 ? new Square(v89, v6) : new Disc(v89, v65);
v54.delete(v30 & 7);
}
try {
v107.id = v37[v69 & 3].n | 0;
v44 = new Strip(v89, v97, v48);
 if (v65 === v75) break L0;
v56 = shapeOf(v105, v109);
v23 = [v82[1], v82[2], v82[3], v82[0]];
v97 = (v113 as Box | null) ?? v97;
v71 = (v62 > 0) ? "" : opaqueText(v111, v0);
}
 finally {
v60 = [v109, v109, spare, (v66 as Box | null) ?? v109];
}
}
for (let c1 = 0;
 c1 < 5;
 c1++) {
const k2: Shape = v112;
v112 = v33;
v33 = v106;
v106 = v90;
v90 = k2;
if (v88 < v115) {
const k3: number = v67, k4: number = v108, k5: number = v105, k6: number = v13, k7: number = v29, k8: number = v12, k9: number = v96, k10: number = v34, k11: number = v19, k12: number = v47, k13: number = v68, k14: number = v99, k15: number = v59, k16: number = v93, k17: number = v6, k18: number = v88, k19: number = v30, k20: number = v45, k21: number = v85, k22: number = v61, k23: number = v8, k24: number = v115, k25: number = v62, k26: number = v89, k27: number = v95, k28: number = v0;
v93 = k27;
v85 = k18;
v8 = k20;
v99 = k3;
v6 = k18;
v59 = k8;
v19 = k12;
v29 = k22;
v30 = k23;
v45 = k13;
v67 = k16;
v61 = k22;
v13 = k11;
v0 = k18;
v68 = k6;
v88 = k21;
v105 = k22;
v89 = k3;
v96 = k28;
v62 = k13;
v115 = k20;
v34 = k26;
v47 = k13;
v108 = k3;
v95 = k8;
v12 = k4;
}
v30 = await later(v105);
}
if (v86 > v30 && v30 > 12) {
try {
v43.set(v89 & 7, (v97.some as number | undefined) ?? v20);
v36.delete(v47 & 7);
}
 finally {
v22 = v102.area(v69) * 0.5;
v88 = (v85 / 10) | 0;
v82[v67 & 3] = (v84 as Box | null) ?? v97;
v60[v96 & 3] = (v29 > 0) ? ((v35.next as Box | null) ?? spare) : opaqueBox(v35, v13);
}
if ((v96 >>> 0) > (v86 >>> 0)) {
v12 = (v69 % -7) | 0;
v82[v89 & 3] = opaqueBox(v97, v10);
}
 else {
v44 = new Disc(v95, v75);
}
v18[v99 & 3] = v80 instanceof Strip ? (v80 as Strip).from : v35;
v66 = v109.next;
v109.next = null;
v62 = scribble(v96 & 7, 1);
}
 else {
await null;
v45 = await laterOrNever(v10);
}
try {
for (let c29 = 0;
 c29 < 2 && ((spare.some as number | undefined) === undefined || c29 < 1);
 c29++, v1 = v96, v96 = v68, v68 = v30, v30 = v6, v6 = v86, v86 = v0, v0 = v67, v67 = v115, v115 = v105, v105 = v12, v12 = v93, v93 = v13, v13 = v85, v85 = v29, v29 = v10, v10 = v108) {
[v4, v23] = [v23, v4];
}
for (let c30 = 0;
 c30 < 4;
 c30++) {
v111 = `${
v47 & 3}
${
v3.slice(0, 3)}
`;
switch (v95 as number) {
case 0: v64 = opaqueDouble(v7, v108);
v40 = (v69 & 7) / (v59 & 1);
v53 = v15;
v83 = new Square(v29, v10);
v13 = v32.indexOf("1");
 break;
case 7: v33 = v112;
v7 = v65;
v112 = v106;
v74 = v39.slice(1) + "q";
v19 = v6;
 break;
case 6: v67 = (((v55.ratio as number | null) ?? 0.5) * 2) | 0;
v22 = v40;
v93 = v61;
v38 = v32;
v103 = `${
v47 & 3}
${
v38.slice(0, 3)}
`;
v26 = v5;
v14 = v40;
v66 = v88 & 3 ? (v2 as Box | null) : new Box(v93, null);
v52 = v60;
v5 = (v35.label as string | undefined) ?? v39;
v107 = v78;
v57 = shapeOf(v105, v97);
 break;
}
}
switch (v105 & 3) {
 case 0: v17 = v6 & 1 ? new Square(v115, v6) : new Disc(v115, v40);
 break;
 case 1: v73.id = v68 > v115 ? v68 : v115;
v95 = (v10 > 0) ? v10 : v29;
v57 = shapeOf(v10, v97);
 case 2: v82[v68 & 3] = v55;
 break;
 default: v31 = v105 & 3 ? (v113 as Box | null) : new Box(v1, null);
v74 = v70.at(-1) ?? "";
 }
switch (v105 as number) {
case 10: case 41: case 65: case 34: case 33: v107 = v51;
 break;
case 56: case 27: case 24: case 4: case 59: v69 = v91.twice | 0;
 break;
case 17: case 63: case 29: case -3: case 39: v76 = v63.padStart(3, "0").slice(-4);
 break;
case 21: case 2: case 30: case 32: case 40: v16 = String(v108 & 15);
 break;
 default: v10 = (v99 % (v13 | 1)) | 0;
}
 if (v75) throw v109;
v68 = (v105 + (await v6)) | 0;
L31: for (let c31 = 0;
 c31 < 4;
 c31++) {
v40 = v89 / ((v85 & 7) + 1);
v58 = v8 & 3 ? (v81 as Box | null) : new Box(v61, null);
v73.id = v19 >> v12;
}
L32: for (let c32 = 0;
 c32 < 4;
 c32++) {
v27 = Math.fround(v40);
v55.label = (v89 > 0) ? v3 : undefined;
v6 = Math.max(v95, v13);
}
if ((v2 as Box | null) !== null) {
v73.id = v59 ^ v45;
v1 = v36.has(v105 & 7) ? v105 : v108;
}
 else {
({
 n: v30, on: sunk }
 = v55);
v30 = v38.charCodeAt(v95 & 3) | 0;
v99 = (v105 >>> (v19 & 31)) | 0;
}
}
 catch (thrown) {
v105 = (fold(thrown) + 1) | 0;
v74 = mix4(v42, v95 * 65536, v88, v61 * 65536, "s", v101, v62 & 1 ? v62 * 0.5 : null, v61, v61 > 0, v34 & 1 ? v34 * 0.5 : null, v34, v95, v59 >>> 0, v19 & 1 ? v19 * 0.5 : null);
v2 = v35.next;
v35.next = null;
v68 = scribble(v115 & 7, 1);
v37 = (v6 > 0) ? v41 : row;
switch (v68 & 3) {
 case 0: v109 = v92 instanceof Strip ? (v92 as Strip).from : v55;
v119.delete(v86 & 7);
v42 = v90 instanceof Disc ? (v90 as Disc).r : v14;
v49 = v119.set(v1 & 7, v34);
 break;
 case 1: v80 = v94;
v63 = `${
v69 & 7}
:${
(words[1] as Word)}
:${
(v69 > 0)}
:${
v32.slice(0, 2)}
`.slice(-7);
v90 = new Strip(v30, v109, v111);
 case 2: v18 = (v115 > 0) ? v37 : row;
v109.some = v35.some;
v97.d = Math.abs(v27);
v17 = v78.grown(v105 & 3);
 break;
 default: v20 = v25 + v96 * 0.1 + opaqueDouble(v25, v105) - v25;
v114.delete(v10 & 7);
v50 = shapeOf(v0, v55);
v83 = new Strip(v86, v109, v104);
 }
}
 finally {
v49.set(v19 & 7, v98 instanceof Disc ? (v98 as Disc).r : v27);
}
}
 catch (thrown) {
note(thrown);
v62 = await later(v85);
note(v82);
}
switch (v99 & 15) {
case 0: v15 = v114.set(v30 & 7, v96);
 break;
case 1: let c33 = 3;
 L33: while (c33-- > 0) {
switch (v86 as number) {
case 2: v82[v69 & 3] = v109;
 break;
case 1: v61 = ((v61 >>> 0) / 2) | 0;
 break;
case 7: v19 = v95;
v86 = ((v47 >>> 0) / 2) | 0;
 break;
}
 if ((v108 & v86) === 0) break;
}
yield v8;
try {
try {
v68 = Math.min(v61, v13, v0);
 if ((words[0] as Word) === "red" && (v31 as Box | null) !== null) return v6;
v100 = v102.area(v47) * 0.5;
}
 finally {
v68 = closure0(v19);
v54.set(v67 & 7, Math.sqrt(Math.abs(v46)));
v110.id = v29 | 0;
v109.ratio = (v97.ratio as number | null) === null ? v42 : (v97.ratio as number | null)! * 0.5;
}
v76 = opaqueText(v71, v85);
 v105 = mayThrow(v85);
L35: {
v83 = new Disc(v13, v27);
 if ((spare.ratio as number | null) === null) break L35;
v103 = (v74 + v74.length).slice(-4);
v56.id = odd[(v0 << 2) & 7] | 0;
v110 = v108 & 1 ? new Square(v30, v108) : new Disc(v30, v42);
}
v69 = v96 > v88 && v88 > 14 ? (v118 as Box | null) === null ? v68 : v29 : (v115 > 0) ? v115 : v105;
v49.delete(v62 & 7);
const k36: Shape = v102, k37: Shape = v44, k38: Shape = v83, k39: Shape = v51, k40: Shape = v106, k41: Shape = v72, k42: Shape = v98, k43: Shape = v110, k44: Shape = v116, k45: Shape = v50, k46: Shape = v87, k47: Shape = v57, k48: Shape = v73, k49: Shape = v77, k50: Shape = v90, k51: Shape = v92, k52: Shape = v112, k53: Shape = v28, k54: Shape = v107, k55: Shape = v91, k56: Shape = v33, k57: Shape = v56, k58: Shape = v78, k59: Shape = v80, k60: Shape = v17, k61: Shape = v79, k62: Shape = v94;
v33 = k54;
v87 = k60;
v79 = k45;
v80 = k38;
v56 = k50;
v72 = k38;
v51 = k62;
v77 = k49;
v50 = k50;
v28 = k48;
v83 = k39;
v112 = k43;
v106 = k59;
v102 = k39;
v44 = k42;
v17 = k58;
v98 = k39;
v73 = k60;
v116 = k58;
v78 = k45;
v92 = k39;
v107 = k52;
v57 = k51;
v90 = k48;
v91 = k52;
v94 = k45;
v110 = k50;
}
 catch (thrown) {
v105 = (v17 instanceof Square ? (v17 as Square).side : v95) | 0;
v82 = v23;
v24 = v64;
v116 = v73;
v108 = v61;
v55 = (v85 > 0) ? ((v55.next as Box | null) ?? spare) : opaqueBox(v55, v86);
v117 = v49.set(v69 & 7, v59);
v60 = v23;
v51 = v33;
v12 = v85;
v8 = v38.charCodeAt((v13 << 1) & 3) | 0;
v101 = v25 > 1e6 || v25 < -1e6 ? 0.5 : v25 * 1.5;
v89 = v115;
v50 = new Strip(v108, v55, v74);
v31 = v66;
v6 = (words[1] as Word).length;
v68 = v62;
v38 = v103;
v15 = v54;
v70 = v103;
v92 = shapeOf(v88, v97);
v81 = v31;
v25 = v46;
v58 = v31;
v47 = fold(thrown);
}
if ((v68 & -2147483648) === 0 && (v47 & 65536) === 0) return scribble(v85 & 7, 1);
 break;
case 2: v35.n = 2147483647;
 break;
case 3: v100 = (v93 & 7) / (v108 & 1);
switch (v30 & 3) {
case -1: v85 = v69 | 0;
 case 7: v84 = v31;
v63 = mix1(v86 >>> 0, v0, v75, words[v62 & 3], words[v19 & 3], v105 * 65536, words[v45 & 3], v47 > 0, v115 & 1 ? v115 : undefined);
 break;
case 2: v23 = (v93 > 0) ? v60 : row;
 }
v1 = f0(v6 & 63, v34 & 63);
for (const each of [v19, v1, 0]) {
v93 = (v99 + each) | 0;
switch (words[v68 & 3]) {
 case "red": v23 = (v61 > 0) ? v4 : row;
v112 = (v108 > 0) ? v28 : round;
v111 = (v109.label as string | undefined) ?? v70;
 break;
 case "green": v18 = (v1 > 0) ? v23 : row;
v43.set(v12 & 7, odd[v86 & 7] * 0.5);
 case "blue": v97.ratio = v61 & 3 ? (v55.ratio as number | null) : v61 + 0.5;
 break;
 default: v54.set(v47 & 7, (v88 > 0) ? v88 : v88);
 }
note(v43);
}
 break;
case 4: v48 = (v97.label as string | undefined) ?? v38;
 break;
case 5: v48 = (v55.label as string | undefined) ?? v111;
 break;
case 6: v37 = v52;
if (v108 > v0) {
v67 = (v19 + (yield v105) + v67 + (yield v19)) | 0;
try {
v119 = new Map([[v13 & 7, v30], [v30 & 7, v20]]);
v55.tag = (words[1] as Word) === "red" ? "green" : (words[1] as Word);
v97.label = (v109.label as string | undefined) === undefined ? v48 : (v109.label as string | undefined)!.slice(1);
v17 = shapeOf(v13, v55);
 if ((v99 & 255) === 1) throw v55;
v97.name = (v63 + (words[1] as Word) + v63).slice(-5);
}
 catch (thrown) {
v13 = (fold(thrown) + 1) | 0;
v2 = v59 & 3 ? (v113 as Box | null) : new Box(v115, null);
}
 finally {
v105 = closure0(v68);
({
 n: v0, on: sunk }
 = v109);
v97.label = (words[1] as Word);
v18[v105 & 3] = v80 instanceof Strip ? (v80 as Strip).from : v55;
}
let c64 = 1;
 L64: while (c64-- > 0) {
({
 n: v96, on: sunk }
 = v35);
v108 = v6 >> (v29 & 31);
v0 = opaqueInt(...([v88, v45] as [number, number]));
 if (v85 > v89 && v89 > 7) continue;
}
try {
({
 n: v67, on: sunk }
 = v35);
v54 = v54;
v114.set(v67 & 7, v19 > v85 ? v19 : v85);
 if ((v30 & 65536) === 0 && v16 < "k") return v45;
v68 = (v113 as Box | null) === null ? v85 : v62;
v94.id = ((v35.some as number | undefined) ?? v45) | 0;
v17 = v78;
}
 finally {
v89 = (v67 + v89) | 0;
v97.n = Math.sign(v95);
}
}
 else {
v13 = await later(v6);
for (let c65 = 0;
 c65 < 4 && (v59 === 2251799813685248 || c65 < 1);
 c65++, v44 = v90, v90 = v98) {
v23 = (v93 > 0) ? v37 : row;
}
try {
v79.id = 0;
v57 = v28;
v87 = v33.grown(v0 & 3);
v110 = new Strip(v59, v55, v71);
}
 finally {
v75 = v77.area(v69) * 0.5;
v85 = (v0 - v29) | 0;
v46 = (v35.ratio as number | null) ?? v20;
}
yield v47;
}
try {
switch (v13 & 63) {
case 29: case 44: ({
 n: v86, on: sunk }
 = v97);
 break;
case 7: case 43: v21 = v60;
 break;
case -2: case 14: v109.w = v89 > 4503599627370496 || v89 < -4503599627370496 ? v89 : v89 * 2;
  default: v86 = Math.min(v29, v12, v89);
}
switch (v59 & 3) {
 case 0: v55.name = (words[1] as Word);
v54 = (v99 > 0) ? v49 : counts;
v49 = v119.set(v62 & 7, v8);
 break;
 case 1: v7 = (v0 > 0) ? v65 : v0 + 0.5;
v36.set(v6 & 7, (v53.get(v108 & 7) ?? v101) * 0.5);
v77 = new Square(v95, v86);
v108 = (v68 >>> (v95 & 31)) | 0;
 case 2: v114 = v54;
v117 = new Map([[v115 & 7, v68], [v68 & 7, v101]]);
({
 n: v88, on: sunk }
 = v97);
 break;
 default: v79.id = v106.twice | 0;
v32 = (v8 > 0) ? (words[1] as Word) : v70;
 }
}
 finally {
let c66 = 2;
 do {
v46 = (v35.ratio as number | null) ?? v24;
}
 while (--c66 > 0 && (v3 === v76));
note(v26);
v18[v6 & 3] = (v45 > 0) ? v109 : spare;
}
const k67: string = v48, k68: string = v103, k69: string = v5, k70: string = v9, k71: string = v63, k72: string = v11, k73: string = v104, k74: string = v71, k75: string = v26, k76: string = v70, k77: string = v38, k78: string = v111, k79: string = v39, k80: string = v74, k81: string = v16, k82: string = v3, k83: string = v32, k84: string = v76;
v32 = k71;
v74 = k74;
v5 = k77;
v9 = k75;
v39 = k70;
v48 = k77;
v3 = k74;
v71 = k75;
v111 = k81;
v104 = k82;
v26 = k76;
v103 = k81;
v38 = k74;
v76 = k74;
v70 = k68;
v11 = k73;
v16 = k72;
v63 = k80;
 break;
case 7: try {
const k85: string = v5, k86: string = v104, k87: string = v32;
v104 = k87;
v5 = k86;
v32 = k86;
 if (v1 <= v67) throw v69;
for (const each of [v30, v19, 0]) {
v86 = (v96 + each) | 0;
v52 = (v68 > 0) ? v41 : row;
}
switch (v62 & 3) {
 case 0: v97 = v83 instanceof Strip ? (v83 as Strip).from : v97;
v54.set(v67 & 7, 2147483648);
 break;
 case 1: v55.tag = v99 & 1 ? "green" : (words[1] as Word);
v37 = [v35, v35, spare, (v113 as Box | null) ?? v35];
v55 = v109;
 case 2: ({
 n: v68, on: sunk }
 = v35);
v90.id = ((v45 >>> 0) / 2) | 0;
 break;
 default: v22 = Math.max(v40, v19);
v105 = (v35.flagged as boolean | undefined) === undefined ? v108 : (v35.flagged as boolean | undefined) ? v61 : v67;
v35.d = Math.abs(v75);
 }
}
 catch (thrown) {
v0 = (fold(thrown) + 1) | 0;
for (let c88 = 0;
 c88 < 2;
 c88++) {
const k89: Map<number, number> = v117;
v117 = v114;
v114 = v49;
v49 = v15;
v15 = v119;
v119 = v53;
v53 = v43;
v43 = v54;
v54 = v36;
v36 = k89;
v59 = opaqueInt(v1, c88);
const k90: number = v27, k91: number = v20, k92: number = v65, k93: number = v101, k94: number = v46, k95: number = v25, k96: number = v22, k97: number = v7, k98: number = v100, k99: number = v40, k100: number = v64, k101: number = v14, k102: number = v42, k103: number = v75, k104: number = v24;
v7 = k104;
v27 = k94;
v40 = k92;
v20 = k96;
v24 = k100;
v42 = k93;
v14 = k96;
v22 = k95;
v65 = k94;
v75 = k90;
v101 = k100;
v46 = k99;
v100 = k93;
v25 = k97;
v64 = k93;
}
}
 finally {
await null;
v31 = v35.next;
v35.next = null;
v1 = scribble(v88 & 7, 1);
let c105 = 1;
 do {
v55 = new Box(v115, null);
v97.name = (v71 + v71.length).slice(-4);
v99 = ((v35.some as number | undefined) ?? v13) | 0;
}
 while (--c105 > 0 && (!(v14 < v46)));
}
v108 = (v8 + (await v96)) | 0;
 break;
case 8: v16 = (v5 + "a").slice(-6);
 break;
case 9: v21[v115 & 3] = v52[v47 & 3];
 break;
case 10: v30 = v9.length;
 case 11: v78 = shapeOf(v6, v97);
 case 12: v112 = v56;
 break;
case 13: v63 = (v95 > 0) ? (words[1] as Word) : v3;
 break;
case 14: ({
 n: v88, on: sunk }
 = v97);
 break;
case 15: note(v21);
for (let c106 = 0;
 c106 < 3;
 c106++) {
v23[v69 & 3] = opaqueBox(v35, v19);
const k107: Shape = v57;
v57 = v94;
v94 = v91;
v91 = v79;
v79 = v77;
v77 = v33;
v33 = v50;
v50 = v83;
v83 = v17;
v17 = k107;
switch (v69 & 3) {
case 3: default: v17.id = (v105 >>> 0) % 10;
 break;
}
}
if (v13 > v61) {
if (v13 > v61) {
v35.name = v33 instanceof Strip ? (v33 as Strip).label : v104;
if (v69 & 1) {
v57 = (v62 > 0) ? v107 : round;
v3 = (v89 > 0) ? (words[1] as Word) : v32;
v84 = v31;
v89 = v115;
v102 = v106;
v31 = v2;
v90 = v112;
v5 = v74;
v25 = v100;
v64 = v65;
v103 = v48;
v101 = Math.floor(v101) + 0.25;
v18 = v23;
v75 = v20;
v36 = v15;
v69 = ((v109.label as string | undefined) ?? "").length;
v73 = v106;
v77 = v44;
v99 = v86;
v54 = v114;
v15 = (v69 > 0) ? v43 : counts;
v56 = shapeOf(v8, v97);
v12 = odd[(v0 << 1) & 7] | 0;
v14 = v40;
v98 = v112;
v60 = v41;
v70 = v32;
v51 = v94;
v63 = (v103 + (words[1] as Word) + v103).slice(-5);
v50 = v51.grown(v89 & 3);
v92 = v91;
v8 = v95;
v72 = v17;
v71 = v9.toUpperCase().slice(0, 4);
v65 = v100;
v113 = v66;
v22 = v97.d;
v33 = shapeOf(v99, v55);
v74 = v39;
v112 = v77;
v21 = [v4[1], v4[2], v4[3], v4[0]];
v87 = v106;
v30 = v13;
v41 = (v8 > 0) ? v18 : row;
v20 = v41[v99 & 3].d;
v108 = v1;
v24 = v100;
v81 = (v96 > 0) ? (v113 as Box | null) : opaqueBox(v109, v96);
v111 = v48;
v104 = v3;
v107 = v85 & 1 ? new Square(v59, v85) : new Disc(v59, v7);
v94 = v110;
v28 = v110;
v62 = (((v97.ratio as number | null) ?? 0.5) * 2) | 0;
v1 = v34;
v85 = ((v97.label as string | undefined) ?? "").length;
v19 = v108;
v109 = v35;
v43 = v54;
v114 = v53;
v42 = v20;
v97 = (v62 > 0) ? ((v55.next as Box | null) ?? spare) : opaqueBox(v55, v69);
v4 = [v109, v109, spare, (v31 as Box | null) ?? v109];
v88 = v93;
}
 else {
v69 = v47;
v103 = v38.toUpperCase().slice(0, 4);
v41 = v18;
v113 = v118;
v22 = v20;
v18 = v23.slice();
v24 = v27;
v101 = v40;
v4 = (v1 > 0) ? v4 : row;
v92 = new Strip(v86, v55, v104);
v109 = v35;
v108 = v6;
v63 = v5;
v75 = Math.sign(v64) * 0.5;
v85 = v88;
v99 = v0;
v114 = v119;
v57 = v107;
v25 = Math.abs(v65);
v71 = (v104 + v104.length).slice(-4);
v14 = (v108 & 7) / (v105 & 1);
v54 = v43;
v81 = v84;
v94 = new Strip(v89, v35, v16);
v36 = new Map([[v61 & 7, v61], [v61 & 7, v27]]);
v15 = v53;
v98 = new Square(v89, v45);
v74 = (v55.label as string | undefined) ?? v63;
v84 = v58;
v102 = v116;
v62 = v96;
v88 = v6;
v90 = shapeOf(v68, v97);
v12 = v88;
v65 = v14;
v112 = v28;
v33 = shapeOf(v108, v109);
v111 = v74;
v60 = v37;
v73 = v78;
v8 = v52[v68 & 3].n | 0;
v31 = v118;
v21 = v18;
v104 = mix1(v12 >>> 0, v69, v40, words[v59 & 3], words[v99 & 3], v47 * 65536, words[v12 & 3], v99 > 0, v12 & 1 ? v12 : undefined);
v5 = v26;
v72 = v83;
v77 = v50;
v28 = v90;
v64 = v46;
v20 = v25;
v70 = v76;
v89 = v1;
v97 = v35;
v51 = v110;
v1 = ((v97.label as string | undefined) ?? "").length;
v50 = new Disc(v8, v64);
v56 = v73;
v3 = v26;
v42 = v75;
v87 = v83;
v43 = (v68 > 0) ? v15 : counts;
v30 = v49.has(v105 & 7) ? v105 : v12;
v19 = v1;
v107 = v79;
}
if ((words[0] as Word) === "blue") {
v119 = (v13 > 0) ? v43 : counts;
v35.d = Math.trunc(v27) * 0.5;
}
 else {
v13 = (v81 as Box | null) === null ? v69 : v108;
}
const k108: number = v96;
v96 = v45;
v45 = v99;
v99 = v61;
v61 = k108;
}
 else {
v55.name = (v108 > 0) ? (words[1] as Word) : v74;
for (const each of [v19, v115, 5]) {
v30 = (v96 + each) | 0;
v50 = v83.grown(v30 & 3);
v83.id = (v108 % 256) | 0;
v72.id = (v49.get(v115 & 7) ?? v59) | 0;
v55.label = (v13 > 0) ? v9 : undefined;
}
}
}
 else {
v116 = new Square(v8, v62);
if (!(v13 > v61)) {
L109: for (let c109 = 0;
 c109 < 1;
 c109++) {
v4[v89 & 3] = (v88 > 0) ? v35 : spare;
}
}
 else {
v77.id = (v35.flagged as boolean | undefined) === undefined ? v6 : (v35.flagged as boolean | undefined) ? v30 : v19;
}
}
if (v64 * 0.5 + v115 > v69 / 3 - v69 && Math.imul(v67, v59) + v67 > v59 * 3) return opaqueInt(v8, v30);
 break;
 default: v114.delete(v85 & 7);
 }
 break;
 case 1: for (let c110 = 0;
 c110 < 4 && (v24 * 0.5 + v47 > v8 / 3 - v8 || c110 < 1);
 c110++, v48 = v104, v104 = v76, v76 = v32, v32 = v39, v39 = v26, v26 = v103, v103 = v38, v38 = v74, v74 = v71, v71 = v63, v63 = v11, v11 = v70, v70 = v16, v16 = v3, v3 = v5, v5 = v111) {
v51 = v112.grown(v10 & 3);
v12 = ((yield v12) + v1) | 0;
}
let c111 = 2;
 do {
v6 = v24 * 0.5 + v0 > v1 / 3 - v1 ? ~v29 : (words[1] as Word).length;
}
 while (--c111 > 0 && (!(v115 & 4)));
try {
switch (words[v61 & 3]) {
 case "red": switch (v19 & 63) {
case 59: case 4: case 15: case 57: case 49: case 16: case 27: v96 = closure0(v61);
 case 7: case 63: case -1: case 60: case 31: case 12: case 23: v113 = v55.next;
 break;
case 21: case 33: case 35: case 11: case 58: case 39: v75 = (v97.ratio as number | null) ?? v14;
v23[v13 & 3] = v52[v47 & 3];
v71 = (v95 > 0) ? "" : opaqueText(v103, v8);
 break;
}
try {
v109.tag = (words[1] as Word);
v37 = [v82[1], v82[2], v82[3], v82[0]];
v2 = (v35.next as Box | null)?.next ?? null;
v73 = shapeOf(v10, v97);
 if (v97 === v55) throw v97;
v80 = v83.grown(v0 & 3);
v95 = v55.n | 0;
v84 = v30 & 3 ? (v81 as Box | null) : new Box(v88, null);
v21 = v21.slice();
}
 catch (thrown) {
v108 = (fold(thrown) + 1) | 0;
({
 n: v69, on: sunk }
 = v97);
v86 = Math.abs(v62) | 0;
}
 finally {
v55.flagged = undefined as boolean | undefined;
}
 break;
 case "green": L112: {
v77 = v87.grown(v47 & 3);
v23[v0 & 3] = (v67 > 0) ? v97 : spare;
 if ((v115 & v96) === 0) break L112;
v44.id = v116 instanceof Strip ? (v116 as Strip).from.n | 0 : v30;
}
v36 = v54.set(v89 & 7, v62);
const k113: number = v115, k114: number = v85, k115: number = v12, k116: number = v88, k117: number = v45;
v88 = k115;
v45 = k114;
v85 = k117;
v115 = k116;
v12 = k115;
 case "blue": v87.id = odd[v115 & 7] | 0;
 break;
 default: note(v78);
 }
const k118: number = v108;
v108 = v61;
v61 = v10;
v10 = v45;
v45 = v34;
v34 = v1;
v1 = v47;
v47 = v6;
v6 = v8;
v8 = k118;
v89 = await laterOrNever(v34);
v12 = v97.w | 0;
v109.w = (((v86 >>> 0) << 4) >>> 0) + (v86 >>> 0);
v12 = opaqueInt(v93, 1);
v61 = v97.w | 0;
 v34 = mayThrow(v8);
v99 = await laterOrNever(v47);
v8 = v55.n > v34 ? v29 >> v8 : ((v96 >>> 0) / 10) | 0;
if ((v96 >>> 0) > (v8 >>> 0)) {
if ((v96 >>> 0) > (v8 >>> 0)) {
note(v4);
}
 else {
v81 = v55.next;
v55.next = null;
v105 = scribble(v95 & 7, 1);
if ((v66 as Box | null) !== null) {
v97 = new Box(v88, (v84 as Box | null));
v78 = v94;
v25 = v46;
v116 = v90;
v47 = v108;
v102 = v6 & 1 ? new Square(v30, v6) : new Disc(v30, v20);
v21 = v18;
v54 = v119;
v85 = v93;
v44 = v102;
v119 = v54;
v64 = v27;
v9 = v74;
v57 = v78;
v69 = (((v35.ratio as number | null) ?? 0.5) * 2) | 0;
v61 = v59;
v41 = v37;
v4 = v21;
v75 = v14;
v58 = v84;
v17 = v92;
v48 = (v34 > 0) ? v76 : "z";
v37 = v21;
v63 = v71;
}
 else {
v69 = v115;
v47 = v0;
v57 = v94;
v4 = v23;
v9 = (v63 + (words[1] as Word) + v63).slice(-5);
v102 = v112;
v116 = new Strip(v29, v97, v26);
v78 = v110;
v61 = v85;
v21 = v60;
v37 = v52;
v58 = v118;
v85 = v8;
v25 = v22;
v48 = v103;
v64 = v22;
v17 = v72.grown(v89 & 3);
v41 = v18;
v97 = opaqueBox(v55, v115);
v54 = v43;
v119 = v49;
v44 = v116;
v63 = v3;
v75 = v64;
}
v34 = await later(v29);
L119: for (let c119 = 0;
 c119 < 3;
 c119++) {
v53.delete(v30 & 7);
}
}
}
 else {
v55.on = v117.has(v67 & 7);
if (!((v96 >>> 0) > (v8 >>> 0))) {
const k120: number = v46, k121: number = v100, k122: number = v22, k123: number = v25, k124: number = v7, k125: number = v24, k126: number = v20, k127: number = v64, k128: number = v42, k129: number = v101, k130: number = v65, k131: number = v75, k132: number = v27, k133: number = v40;
v101 = k122;
v22 = k129;
v40 = k120;
v20 = k125;
v7 = k124;
v27 = k126;
v64 = k127;
v75 = k131;
v65 = k121;
v42 = k123;
v24 = k126;
v25 = k127;
v46 = k123;
v100 = k132;
}
 else {
v14 = v30 / ((v61 & 7) + 1);
}
}
}
 catch (thrown) {
v1 = Math.imul(v108, v88);
v55 = v55;
v9 = v26;
v116 = v51;
v20 = v75;
v110 = shapeOf(v30, v35);
v38 = v16;
v78 = shapeOf(v93, v109);
v33 = v44;
v117 = v36;
v24 = v25;
v3 = v70.padStart(3, "0").slice(-4);
v70 = v3;
v30 = (v29 % 256) | 0;
v58 = v66;
v111 = v71;
v108 = v47;
v54 = v53;
v82 = v23.slice();
v97 = (v61 > 0) ? v55 : spare;
v23 = v41;
v84 = v31;
v106 = v87;
v109 = v55;
v12 = fold(thrown);
}
 case 2: switch (v115 & 3) {
 case 0: try {
v80.id = closure0(v59);
try {
v87 = v34 & 1 ? new Square(v115, v34) : new Disc(v115, v40);
v57.id = (v95 >>> 0) | 0;
 if (v42 < v47) throw v32;
v112 = new Square(v12, v89);
v98 = (v34 > 0) ? v56 : round;
}
 catch (thrown) {
v19 = (fold(thrown) + 1) | 0;
v115 = (v13 + -2147483643) | 0;
v99 = v85 | 0;
v52[v105 & 3] = opaqueBox(v109, v59);
}
 finally {
({
 n: v88, on: sunk }
 = v97);
v21[v86 & 3] = (v2 as Box | null) ?? v35;
v82[v45 & 3] = new Box(v62, null);
({
 n: v99, on: sunk }
 = v35);
}
try {
v48 = v82[v99 & 3].name;
v69 = (v61 % ((v59 & 15) + 1)) | 0;
v63 = (v9 + "a").slice(-6);
v53 = new Map([[v45 & 7, v13], [v13 & 7, v100]]);
 if (v111 < "k" && (v96 > 1) === true) return v19;
v52 = v52;
v82[v6 & 3] = new Box(v47, null);
v45 = v18.length;
}
 finally {
v26 = v77 instanceof Strip ? (v77 as Strip).label : v48;
v93 = Math.max(v0, v88);
}
switch (v85 & 15) {
case 0: v81 = null as Box | null;
 break;
case 1: v109.ratio = null as number | null;
 break;
case 2: v77 = (v95 > 0) ? v98 : round;
 break;
case 3: v112.id = (v58 as Box | null) === null ? v34 : v62;
 break;
case 4: v104 = v94 instanceof Strip ? (v94 as Strip).label : v38;
 break;
case 5: v55.d = opaqueDouble(v20, v12);
 case 6: v64 = v25 + v99 * 0.1 + opaqueDouble(v25, v115) - v25;
v50 = shapeOf(v93, v109);
 break;
case 7: v36.set(v19 & 7, (v75 * 3) | 0);
v94 = (v12 > 0) ? v17 : round;
 break;
case 8: ({
 n: v85, on: sunk }
 = v35);
v87 = shapeOf(v62, v55);
 break;
case 9: v95 = v50.id;
 break;
case 10: v41[v10 & 3] = (v1 > 0) ? v109 : spare;
 break;
case 11: ({
 n: v30, on: sunk }
 = v97);
v70 = (v9 + "a").slice(-6);
v66 = v97;
 break;
case 12: v0 = (v30 - v96) | 0;
 break;
case 13: v27 = v20 * 0.5 + v88;
 break;
 default: v12 = (v6 - v86) | 0;
 }
}
 finally {
v33.id = v19 ^ v68;
}
 break;
 case 1:  case 2:  break;
 default:  }
 break;
 default:  }
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ v6 ^ fold(v7) ^ v8 ^ fold(v9) ^ v10 ^ fold(v11) ^ v12 ^ v13 ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ fold(v17) ^ fold(v18) ^ v19 ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ fold(v23) ^ fold(v24) ^ fold(v25) ^ fold(v26) ^ fold(v27) ^ fold(v28) ^ v29 ^ v30 ^ fold(v31) ^ fold(v32) ^ fold(v33) ^ v34 ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ fold(v38) ^ fold(v39) ^ fold(v40) ^ fold(v41) ^ fold(v42) ^ fold(v43) ^ fold(v44) ^ v45 ^ fold(v46) ^ v47 ^ fold(v48) ^ fold(v49) ^ fold(v50) ^ fold(v51) ^ fold(v52) ^ fold(v53) ^ fold(v54) ^ fold(v55) ^ fold(v56) ^ fold(v57) ^ fold(v58) ^ v59 ^ fold(v60) ^ v61 ^ v62 ^ fold(v63) ^ fold(v64) ^ fold(v65) ^ fold(v66) ^ v67 ^ v68 ^ v69 ^ fold(v70) ^ fold(v71) ^ fold(v72) ^ fold(v73) ^ fold(v74) ^ fold(v75) ^ fold(v76) ^ fold(v77) ^ fold(v78) ^ fold(v79) ^ fold(v80) ^ fold(v81) ^ fold(v82) ^ fold(v83) ^ fold(v84) ^ v85 ^ v86 ^ fold(v87) ^ v88 ^ v89 ^ fold(v90) ^ fold(v91) ^ fold(v92) ^ v93 ^ fold(v94) ^ v95 ^ v96 ^ fold(v97) ^ fold(v98) ^ v99 ^ fold(v100) ^ fold(v101) ^ fold(v102) ^ fold(v103) ^ fold(v104) ^ v105 ^ fold(v106) ^ fold(v107) ^ v108 ^ fold(v109) ^ fold(v110) ^ fold(v111) ^ fold(v112) ^ fold(v113) ^ fold(v114) ^ v115 ^ fold(v116) ^ fold(v117) ^ fold(v118) ^ fold(v119)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 21; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    hash = (Math.imul(hash, 31) + (await drainedLater((a => f1(a, b, (a * 1 + b * 4 + 24) | 0, (a * 2 + b * 7 + 49) | 0, (a + 2) & 1 ? new Box(a, null) : null, String((a + 3) & 31)))(i), i % 5 ? -1 : (i >> 2) & 15))) | 0;
  }
  console.log("f1 " + (hash >>> 0).toString(16));
  console.log("f1 on the way " + (sink >>> 0).toString(16));
}

async function f2(a: number, b: number): Promise<number> {
if (b > 60) return (a + b) | 0;
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v0: number = (a * 1 + b * 3 + 35) | 0;
let v1: number = (a * 2 + b * 6 + 1) | 0;
let v2: number = (a * 3 + b * 1 + 23) | 0;
let v3: boolean = ((a + 3) & 1) === 0;
let v4: Shape = shapeOf(a + 4, new Box(b, null));
let v5: string = String((a + 5) & 31);
let v6: Word = words[(a + 6) & 3];
let v7: string | undefined = (a + 7) & 1 ? String(b) : undefined;
let v8: number = (a * 9 + b * 4 + 34) | 0;
let v9: boolean | undefined = (a + 9) & 1 ? a > b : undefined;
let v10: Int32Array = new Int32Array([a, b, -a, 7, a ^ b, 300 - b, -1, b * 1000]);
let v11: number | null = (a + 11) & 1 ? a * 0.5 : null;
const closure0 = (x: number): number => {
 v0 = (v0 + x) | 0;
 return v0 ^ v0;
 }
;
const closure1 = (x: number): number => {
 v1 = (v1 + x) | 0;
 return v1 ^ v1;
 }
;
v11 = odd[v1 & 7];
for (const each of [v0, v2, 5]) {
v8 = (v1 + each) | 0;
if (v8) {
v2 = v0 & 2 ? Math.abs(v1) | 0 : v2 >> v0;
for (let c0 = 0;
 c0 < 2;
 c0++) {
v7 = v5;
v8 = opaqueInt(v8, c0);
v7 = v5;
[v0, v2] = await Promise.all([later(v0), later(v2)]);
}
}
 else {
try {
switch ((v6 as Word)) {
 case "red": v11 = mix3(v1 * 0.5, v3, v2 & 1 ? spare : null, v0 * 0.5, v1 * 0.5, v8 & 1 ? spare : null, (v11 as number | null), v2 * 0.5, v0 * 0.5);
v7 = v5;
v9 = (v9 as boolean | undefined);
 break;
 case "green": v0 = counts.size;
v3 = !v3;
v6 = (v6 as Word);
 case "blue": v1 = mayThrow(v1);
 break;
 default: v0 = v2 >> v8;
v3 = row[v2 & 3] === spare;
 }
if (v5) {
v0 = Math.imul(v8, v2);
}
 else {
v9 = v3;
v7 = undefined as string | undefined;
v2 = Math.clz32(v0);
}
 v8 = mayThrow(v1);
v4 = new Square(v2, v0);
await null;
}
 catch (thrown) {
v0 = v0 << (v0 & 31);
v3 = (v9 as boolean | undefined) ?? v3;
v10[v8 & 7] = Math.max(v0, v1);
v9 = v3 ? v2 > v0 : undefined;
v4 = v3 ? v4 : round;
v1 = v0;
v6 = v3 ? "red" : "blue";
v5 = v3 ? v5 : "z";
v2 = fold(thrown);
}
}
try {
v6 = words[v0 & 3];
if ((((v0 ^ v0) + (v1 & v0)) | 0) > ((v0 - v2) | 0)) {
v1 = await laterOrNever(v2);
v4 = v3 ? v4 : round;
for await (const each of someLater(v1 & 3)) v2 = (v2 + each) | 0;
v4 = v1 & 1 ? new Square(v8, v1) : new Disc(v8, v1);
}
 else {
v1 = v2 > v0 ? Math.clz32(v8) : Math.min(v2, v2, v0);
for (let c1 = 0;
 c1 < 2;
 c1++) {
v0 = (((v11 as number | null) ?? 0.5) * 2) | 0;
switch (v1 & 3) {
case 6: default: v10[v2 & 7] = mix0((v6 as Word), v0 & 1 ? v0 : undefined, v0 & 1 ? v0 : undefined);
 break;
}
}
v8 = counts.has(v1 & 7) ? v1 : v1;
v2 = mayThrow(v1);
}
 if ((v8 & 255) === 0) throw v2;
const k2: number = v2;
v2 = v8;
v8 = v1;
v1 = k2;
[v1, sink] = await Promise.all([later(v1), later(v1)]);
}
 catch (thrown) {
v0 = (fold(thrown) + 1) | 0;
v4.id = ((v1 >>> 0) / 3) | 0;
L3: for (let c3 = 0;
 c3 < 5;
 c3++) {
if (v2 <= v0) {
v3 = spare.on;
v0 = opaqueAny(v8 & 7 ? spare : null).n | 0;
v1 = Math.max(v2, v1);
v5 = (v6 as Word);
v2 = Math.sign(v8);
v7 = undefined as string | undefined;
v10[v0 & 7] = v2 + v2 * 0.1 + opaqueDouble(v2, v8) - v2;
v9 = v3 ? v2 > v1 : undefined;
v8 = v0;
v11 = v3 ? v1 : null;
v6 = v3 ? (v6 as Word) : "";
v4 = v4.grown(v1 & 3);
}
 else {
v1 = v0;
v5 = String(v1 & 15);
v6 = spare.tag;
v0 = v2;
v9 = undefined as boolean | undefined;
v4 = shapeOf(v0, spare);
v3 = row[v1 & 3] === spare;
v2 = v0;
v11 = odd[v8 & 7];
v8 = v1;
v10[v8 & 7] = (v2 * 2) >>> 0;
v7 = v3 ? v5 : undefined;
}
}
if ((v10[v0 & 7] | 0) > v0) {
v2 = opaqueInt(...([v1, v2] as [number, number]));
v7 = (v6 as Word);
v8 = v1;
v1 = v2;
v0 = Math.sign(v0);
v10[v2 & 7] = (v0 / ((v0 & 15) + 1)) | 0;
v4 = v4;
v3 = (v9 as boolean | undefined) ?? v3;
v9 = spare.flagged;
v5 = opaqueText(v5, v8);
v11 = spare.ratio;
v6 = (v6 as Word);
}
 else {
v11 = (v11 as number | null) === null ? v1 : (v11 as number | null)! * 0.5;
v0 = opaqueInt(...([v8, v2] as [number, number]));
v6 = words[v1 & 3];
v2 = opaqueInt(v0, v0);
v7 = undefined as string | undefined;
v9 = spare.flagged;
v4 = v2 & 1 ? new Square(v8, v2) : new Disc(v8, v2);
v3 = v4 instanceof Square;
v5 = v3 ? v5 : "z";
v10[v8 & 7] = v0 * 2 % 9007199254740991;
v8 = v0;
v1 = v2 << v8;
}
}
 finally {
try {
v2 = v2 ? (v1 % -7) | 0 : (v8 + 15) | 0;
v11 = v3 ? odd[v2 & 7] : (v11 as number | null);
 if (v1 >= v0) throw v2;
for (let c4 = 0;
 c4 < 3;
 c4++) {
const k5: number = v1;
v1 = v2;
v2 = v8;
v8 = v0;
v0 = k5;
if (v8 < v1) {
v11 = (v11 as number | null) === null ? v8 : (v11 as number | null)! * 0.5;
}
}
v11 = v0 & 3 ? (v11 as number | null) : v0 + 0.5;
if (!(v2 & 4)) {
v3 = v3 || v1 < 0;
v10[v0 & 7] = v8 * 0;
v2 = v2 > v0 ? v2 : v0;
}
 else {
v5 = `${
v1 & 7}
:${
(v6 as Word)}
:${
v3}
:${
v5.slice(0, 2)}
`.slice(-7);
}
v3 = spare.on;
}
 catch (thrown) {
v0 = (fold(thrown) + 1) | 0;
v1 = (v0 + (await later(v8)) + Math.imul(v1, await later(v0))) | 0;
[v2, v0] = await Promise.all([later(v2), later(v2)]);
L6: {
v10[v2 & 7] = (spare.next as Box | null)?.next?.n ?? v2;
v1 = ~v2;
 if (v8 <= 2147483647) break L6;
v8 = (v1 * 0.5 + v2) | 0;
}
}
 finally {
if (v8 > v8) {
v5 = mix4(v2 * 0.5, v8 * 65536, v1, v2 * 65536, v5, v0 * 0.5, (v11 as number | null), v0, v3, (v11 as number | null), v1, v8, v2 >>> 0, (v11 as number | null));
v0 = v1;
v6 = (v6 as Word) === "red" ? "green" : (v6 as Word);
v7 = (v7 as string | undefined) === undefined ? v5 : (v7 as string | undefined)!.slice(1);
v10[v8 & 7] = ((v0 >>> 0) << 9) >>> 0;
v11 = v1;
v8 = v8 >> v2;
v2 = v1;
v3 = (v1 >>> 0) > 2147483647;
v4 = new Square(v8, v1);
v9 = spare.flagged;
v1 = ((v2 >>> 0) / 3) | 0;
}
 else {
v10[v8 & 7] = v10[((v8 << 3) >>> 0) % 8] | 0;
v2 = Math.abs(v2) | 0;
v11 = v3 ? -0 : null;
v4 = v3 ? v4 : round;
v1 = (v1 >>> 0) | 0;
v5 = (v5 + v5.length).slice(-4);
v3 = v1 === undefined;
v8 = v0;
v9 = (v9 as boolean | undefined) === undefined ? v3 : !(v9 as boolean | undefined);
v6 = spare.tag;
v7 = (v7 as string | undefined);
v0 = ((v7 as string | undefined) ?? "").length;
}
try {
v1 = (v0 / ((v1 & 15) + 1)) | 0;
v11 = mix3(v2 * 0.5, v3, v2 & 1 ? spare : null, v8 * 0.5, v0 * 0.5, v0 & 1 ? spare : null, (v11 as number | null), v2 * 0.5, v8 * 0.5);
v7 = (v6 as Word);
v2 = opaqueInt(...([v1, v8] as [number, number]));
}
 finally {
v9 = v3 ? v8 > v0 : undefined;
}
for await (const each of someLater(v2 & 3)) v0 = (v0 + each) | 0;
switch (v2 & 3) {
 case 0: v8 = v10[v2 & 7] | 0;
v5 = String(v1 & 15);
v2 = (v2 * 3) | 0;
v5 = String(v2 & 15);
 break;
 case 1: v4.id = Math.sign(v2);
v4.id = (v2 % 10) | 0;
 case 2: v8 = (v5[v2 & 1] ?? "x").length;
v4.id = (v1 + 91) | 0;
 break;
 default: v11 = v8 & 3 ? (v11 as number | null) : v8 + 0.5;
v4 = new Square(v0, v0);
v5 = (v5 + "a").slice(-6);
 }
}
v1 = await later(v2);
for (let c7 = 0;
 c7 < 3 && (v0 <= v8 || c7 < 1);
 c7++) {
v6 = v3 ? (v6 as Word) : "";
v0 = opaqueInt(v1, c7);
[v0, v8] = await Promise.all([later(v0), later(v8)]);
}
}
L8: {
switch (v1 & 7) {
case 0:  break;
case 1: v7 = v3 ? v5 : undefined;
 case 2: v11 = mix2(v5, spare, (v6 as Word), spare, (v11 as number | null), v0, (v6 as Word), v8 * 0.5, v0, (v11 as number | null), v1 & 1 ? v1 : undefined, spare, v2 * 65536, v0 > 0);
 break;
case 3: v3 = v2 < v8;
 break;
case 4: v4 = v4;
 break;
case 5:  break;
case 6:  break;
case 7: v6 = (v6 as Word);
  default: v10[v0 & 7] = (v1 >>> 0) * 8 + v1;
 }
 if (v0 > v0) break L8;
}
}
return (v0 ^ v1 ^ v2 ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ v8 ^ fold(v9) ^ fold(v10) ^ fold(v11)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 99; i += 3) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    for (const each of await Promise.allSettled([(a => f2(a, b))(i), (a => f2(a, b))(i + 1), (a => f2(a, b))(i + 2)])) hash = (Math.imul(hash, 31) + settled(each)) | 0;
  }
  console.log("f2 " + (hash >>> 0).toString(16));
  console.log("f2 on the way " + (sink >>> 0).toString(16));
}

function f3(a: number, b: number, v0: number, v1: number, v2: number, v3: number, v4: number, v5: Map<number, number>, v6: Shape): number {
if (a === 7) return opaqueInt(a, b);
if (a === 9) return a;
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v7: string = String((a + 7) & 31);
let v8: Box[] = [new Box(a, null), new Box(b, null), new Box(8, null), new Box(a + b, null)];
let v9: Box | null = (a + 9) & 1 ? new Box(a, null) : null;
let v10: Word = words[(a + 10) & 3];
let v11: number = (a * 12 + b * 1 + 32) | 0;
let v12: any = a + 12;
let v13: Shape = shapeOf(a + 13, new Box(b, null));
let v14: Map<number, number> = new Map([[a & 7, b], [6, a * 0.5]]);
let v15: Box | null = (a + 15) & 1 ? new Box(a, null) : null;
let v16: number = (a * 17 + b * 7 + 30) | 0;
let v17: Word = words[(a + 17) & 3];
let v18: number = (a * 19 + b * 2 + 46) | 0;
let v19: number = a * 65536 + b + 19;
let v20: any = String(b);
let v21: Int8Array = new Int8Array([a, b, -a, 7, a ^ b, 300 - b, -1, b * 1000]);
let v22: Box | null = (a + 22) & 1 ? new Box(a, null) : null;
let v23: number = (a * 24 + b * 8 + 8) | 0;
note(v1);
v7 = mix1(v0 >>> 0, v1, v23 * 0.5, words[v1 & 3], words[v1 & 3], v19, (v17 as Word), v16 > 0, v1 & 1 ? v1 : undefined);
return (v0 ^ v1 ^ v2 ^ v3 ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ v11 ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) ^ v16 ^ fold(v17) ^ v18 ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ v23) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 20; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    try {
      hash = (Math.imul(hash, 31) + (a => f3(a, b, (a * 1 + b * 3 + 23) | 0, (a * 2 + b * 6 + 1) | 0, (a * 3 + b * 5 + 14) | 0, (a * 4 + b * 1 + 40) | 0, a * 4.5 + b / 4, new Map([[a & 7, b], [5, a * 0.5]]), shapeOf(a + 6, new Box(b, null))))(i)) | 0;
    } catch (thrown) {
      hash = (hash ^ fold(thrown)) | 0;
    }
  }
  console.log("f3 " + (hash >>> 0).toString(16));
  console.log("f3 on the way " + (sink >>> 0).toString(16));
}

export {};
