// Found by the fuzzer (values-across-joins-multi-file, seed 1793417297465): f3 is a generator of thirteen parameters that sets the last one to null behind yields. An executable printed other sums for f3 and, out of the same running hash, for f4.
// @ts-nocheck
// generator 120 (12) of int+wide+double+uint+number . 12 (7) of int+maybeBox+text+table+boxes+shape . 6 (6) of int+box+text+maybeText . generator 12 (11) of int+flag+maybeFlag+any+maybeInt+memory+maybeBox . asyncGenerator 6 (4) of int+maybeInt+maybeDouble
export type Word = "red" | "green" | "blue" | "";
export const words: Word[] = ["red", "green", "blue", ""];
export function* some(count: number): Generator<number, number, number> {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + (yield i)) | 0;
  return sum;
}
export class Box {
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
export abstract class Shape {
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
export class Square extends Shape {
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
export class Disc extends Shape {
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
export class Strip extends Shape {
  get twice(): number {
    return this.from.w;
  }
}
export function shapeOf(x: number, box: Box): Shape {
  tick();
  return x % 3 === 0 ? new Square(x, x & 255) : x % 3 === 1 || x % 3 === -1 ? new Disc(x, x * 0.5) : new Strip(x, box, "s" + (x & 3));
}
export const odd = new Float64Array(
  new BigUint64Array([0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffa000000000000n, 0x7ff8000000000000n, 0x7ff0000000000000n, 0x8000000000000000n, 0xfffe000000000001n]).buffer,
);
export function fold(value: any): 1 {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : value === Infinity ? 19 : value === -Infinity ? 23 : ((value * 1000) | 0) ^ ((value / 4294967296) | 0);
    case "boolean":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    case "undefined":
      let sum = 0;
      for (let i = 0; i < value.length; i++) sum = (Math.imul(sum, 31) + fold(value[i])) | 0;
      return sum;
  }
}
export function foldBox(box: Box): 1 {
  return box.n ^ fold(box.d) ^ fold(box.w) ^ fold(box.u) ^ fold(box.on) ^ fold(box.tag) ^ fold(box.name) ^ fold(box.some) ^ fold(box.ratio) ^ fold(box.flagged) ^ fold(box.label);
}
export function opaqueInt(x: number, y: number): 1 {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
export function opaqueMaybe(x: number): number | undefined {
  tick();
  return x & 1 ? undefined : x;
}
export function opaqueAny(x: any): any {
  tick();
  return x;
}
export function mayThrow(x: number): number {
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
export function throwsFromBelow(x: number, deeper: number): number {
  const i0 = x ^ 21845, i1 = (x + 77) | 0, i2 = Math.imul(x, 31), i3 = x >> 1, i4 = ~x, i5 = (x - 9) | 0, d0 = x * 0.5, d1 = x + 0.25; // prettier-ignore
  const below = deeper > 0 ? throwsFromBelow(x, deeper - 1) : mayThrow(x);
  return (below ^ i0 ^ i1 ^ i2 ^ i3 ^ i4 ^ i5 ^ fold(d0) ^ fold(d1)) | 0;
}
export function scribble(x: number, deeper: number): number {
}
export async function laterOrNever(x: number): Promise<number> {
  tick();
  if ((x & 15) === 9) throw x;
  return (x + 1) | 0;
}
export async function* someLater(count: number): AsyncGenerator<number, number, unknown> {
  for (let i = 0; i < count; i++) yield await later(i);
  return count;
}
export function drained(steps: Generator<number, number, number>, stop: number): number {
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
export async function drainedLater(steps: AsyncGenerator<number, number, number>, stop: number): Promise<number> {
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
export function settled(result: PromiseSettledResult<number>): number {
  return result.status === "fulfilled" ? result.value : fold(result.reason) + 1;
}
export function mix2(p0, p1, p2) {
  tick();
  return (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) | 0) * 0.125;
}
export function mix3(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13) {
  tick();
  return (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19) ^ Math.imul(fold(p9), 21) ^ Math.imul(fold(p10), 23) ^ Math.imul(fold(p11), 25) ^ Math.imul(fold(p12), 27) ^ Math.imul(fold(p13), 29) | 0) * 0.125;
}
export function mix4(p0, p1, p2, p3, p4) {
  tick();
  return (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) | 0) * 0.125;
}
export function f2(a, b, v0, v1, v2, v3, v4, v5) {
  if (b > 60)
    return a + b | 0;
  const spare = new Box(a, null), round = new Disc(b, a * 0.5), row = [spare, spare, spare, spare], counts = new Map([[1, a]]);
  let sunk = !1;
  const closure0 = (x) => {
    v0 = v0 + x | 0;
    return v0 ^ v1;
  }, closure1 = (x) => {
    v1 = v1 + x | 0;
    return v1 ^ v1;
  };
  v0 = round.twice | 0;
  return v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ v4 ^ fold(v5) | 0;
}
export function* f3(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) {
  if (a === 7)
    return opaqueInt(a, b);
  if (a === 9)
    return a;
  const spare = new Box(a, null), round = new Disc(b, a * 0.5), row = [spare, spare, spare, spare], counts = new Map([[1, a]]);
  let sunk = !1, v10 = new Int8Array([a, b, -a, 7, a ^ b, 300 - b, -1, b * 1000]);
  const closure0 = (x) => {
    v1 = v1 + x | 0;
    return v1 ^ v7;
  }, closure1 = (x) => {
    v0 = v0 + x | 0;
    return v0 ^ v4;
  };
  v9 = v4 & 3 ? v9 : v4;
  yield v7;
  let c0 = 1;
  do {
    try {
      v7 = v7 + (yield v0) + v7 + (yield v7) | 0;
      if ((v4 | 0) < v4 && (v7 | 0) === v1)
        return v0;
      if (v0 + v0 > v1 - v1 && v0 - v1 < v1 + v0) {
      }
      yield v4;
      v1 = mayThrow(v0);
      if (v4 <= 43)
        if (v4 <= 43) {
          if ((v4 & 255) === 1) {
            v2 = spare.on;
            v7 = Math.abs(v1) | 0;
          } else
            v4 = v7 >>> (v4 & 31) | 0;
          for (let c3 = 0;c3 < 2 && c3 < 1; c3++, v7 = v4, v4 = v1, v1 = v0) {
            [v8, v5, v2] = [v5, v2, v8];
            v1 = opaqueInt(v0, c3);
            v4 = v7 + (yield v4) + v4 + (yield v7) | 0;
          }
          v7 = ((v4 ^ v0) + (v1 & v4) | 0) > (v0 - v7 | 0) ? Math.sign(v4) : spare.n | 0;
          v8 = v5 || v7 < 0;
        } else {
          v0 = v7 + (yield v4) + v0 + (yield v7) | 0;
          try {
            v3 = v5 ? v1 > v1 : void 0;
            if (v1 & 16)
              throw v0;
            v7 = v1 >> v7;
            v11 = spare.next?.next ?? null;
          } catch (thrown) {
            v7 = fold(thrown) + 1 | 0;
            v7 = v7 + 2147483646 | 0;
            v8 = v11 === null;
          } finally {
            v2 = round instanceof Square;
          }
        }
      else if (v4 <= 43)
        switch (words[v1 & 3]) {
          case "red":
            v6 = v4;
            v1 = v0 + v4 | 0;
            v7 = v0 << v4;
            v4 = closure1(v4);
            v9 = v8 ? -1 : v9;
            v10[v4 & 7] = v1 % 1 | 0;
            v7 = Math.max(v7, v1);
        }
      else
        v11 = null;
      v1 = v1 + (yield* some(v7 & 3)) | 0;
    } catch (thrown) {
      v4 = v0;
      v0 = opaqueInt(...[v4, v4]);
      v9 = v4;
      v4 = fold(thrown);
    }
    v0 = v9 === void 0 ? spare.next?.next?.n ?? v4 : v7 / 65536 | 0;
  } while (--c0 > 0 && spare.n > v0);
  return v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ v4 ^ fold(v5) ^ fold(v6) ^ v7 ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) | 0;
}
export async function* f4(a, b, v0, v1, v2, v3) {
  const spare = new Box(a, null), round = new Disc(b, a * 0.5), row = [spare, spare, spare, spare], counts = new Map([[1, a]]);
  let sunk = !1, v4 = a * 5 + b * 6 + 36 | 0, v5 = a + 5 & 1 ? a * 0.5 : null;
  const closure0 = (x) => {
    v1 = v1 + x | 0;
    return v1 ^ v1;
  };
  v0 = v1 / (v0 | 1) | 0;
  return v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ v4 ^ fold(v5) | 0;
}
let calls = 0;
let sink = 0;
function tick(): void {
  if (++calls % 977 === 0)
    try {
      throw calls;
    } catch {}
}
function note(value: any): void {
  tick();
  sink = (Math.imul(sink, 31) + fold(value)) | 0;
}
function* f0(a: number, b: number, v0: number, v1: number, v2: number, v3: number, v4: number, v5: number, v6: number, v7: number, v8: number, v9: number, v10: number, v11: number): Generator<number, number, number> {
let v119: number = a * 119.5 + b / 4;
v3 = (counts.get(v88 & 7) ?? v29) | 0;
let c0 = 1;
 do {
switch (words[v91 & 3]) {
 case "red": v54 = (v101 ^ v64) >>> 0;
if ((spare.ratio as number | null) === null && (words[0] as Word) === "blue") return v60;
 break;
 case "green": switch (v40 & 3) {
 case 0: v103 = v69;
}
 }
for (const each of [v73, v56, 1]) {
v49 = (v12 + each) | 0;
const k34: number = v14, k35: number = v3, k36: number = v64, k37: number = v43, k38: number = v49;
v14 = k34;
v3 = k38;
v43 = k35;
v64 = k34;
v49 = k38;
}
}
 while (--c0 > 0 && (v54 > 2147483647));
v24 = (v82 + (yield v21) + v24 + (yield v82)) | 0;
v38 = (v76 + (yield v43) + v38 + (yield v76)) | 0;
return (v0 ^ v1 ^ fold(v2) ^ v3 ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ v7 ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ v12 ^ fold(v13) ^ v14 ^ fold(v15) ^ fold(v16) ^ v17 ^ fold(v18) ^ fold(v19) ^ fold(v20) ^ v21 ^ fold(v22) ^ v23 ^ v24 ^ fold(v25) ^ fold(v26) ^ fold(v27) ^ fold(v28) ^ v29 ^ fold(v30) ^ fold(v31) ^ fold(v32) ^ fold(v33) ^ fold(v34) ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ v38 ^ fold(v39) ^ v40 ^ fold(v41) ^ fold(v42) ^ v43 ^ fold(v44) ^ fold(v45) ^ fold(v46) ^ v47 ^ v48 ^ v49 ^ fold(v50) ^ fold(v51) ^ fold(v52) ^ v53 ^ fold(v54) ^ fold(v55) ^ v56 ^ fold(v57) ^ fold(v58) ^ fold(v59) ^ v60 ^ v61 ^ v62 ^ fold(v63) ^ v64 ^ fold(v65) ^ fold(v66) ^ fold(v67) ^ fold(v68) ^ fold(v69) ^ v70 ^ fold(v71) ^ fold(v72) ^ v73 ^ fold(v74) ^ fold(v75) ^ v76 ^ fold(v77) ^ fold(v78) ^ v79 ^ fold(v80) ^ fold(v81) ^ v82 ^ v83 ^ fold(v84) ^ fold(v85) ^ fold(v86) ^ fold(v87) ^ v88 ^ fold(v89) ^ v90 ^ v91 ^ v92 ^ fold(v93) ^ fold(v94) ^ fold(v95) ^ fold(v96) ^ fold(v97) ^ fold(v98) ^ fold(v99) ^ fold(v100) ^ fold(v101) ^ fold(v102) ^ fold(v103) ^ v104 ^ v105 ^ fold(v106) ^ fold(v107) ^ fold(v108) ^ fold(v109) ^ fold(v110) ^ fold(v111) ^ fold(v112) ^ fold(v113) ^ v114 ^ fold(v115) ^ fold(v116) ^ fold(v117) ^ fold(v118) ^ fold(v119)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 99; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    hash = (Math.imul(hash, 31) + drained((a => f0(a, b, (a * 1 + b * 7 + 24) | 0, (a * 2 + b * 0 + 23) | 0, a * -8589934592 + b + 2, (a * 4 + b * 8 + 30) | 0, a * 4.5 + b / 4, a * 4294967296 + b + 5, a * 65536 + b + 6, (a * 8 + b * 0 + 36) | 0, a * 8.5 + b / 4, a * 9.5 + b / 4, a * 10.5 + b / 4, (a * 12 - b) >>> 0))(i), i % 5 ? -1 : (i >> 2) & 15)) | 0;
  }
  console.log("f0 " + (hash >>> 0).toString(16));
  console.log("f0 on the way " + (sink >>> 0).toString(16));
}
function f1(a: number, b: number, v0: number, v1: number, v2: Box | null, v3: string, v4: number, v5: number, v6: Map<number, number>): number {
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let sunk = false;
let v7: number = (a * 8 + b * 4 + 28) | 0;
let v8: Box[] = [new Box(a, null), new Box(b, null), new Box(8, null), new Box(a + b, null)];
let v9: Map<number, number> = new Map([[a & 7, b], [1, a * 0.5]]);
let v10: Shape = shapeOf(a + 10, new Box(b, null));
let v11: number = (a * 12 + b * 8 + 26) | 0;
for (const each of [v7, v11, 7]) {
v11 = (v5 + each) | 0;
v2 = (v5 > 0) ? spare : null;
}
try {
const k0: Map<number, number> = v9;
v9 = v6;
v6 = k0;
try {
if (v5 & 2) {
if (v4) {
}
}
v11 = (spare.flagged as boolean | undefined) === undefined ? v1 : (spare.flagged as boolean | undefined) ? v4 : v7;
}
 catch (thrown) {
note(thrown);
try {
if (v7 > v0) {
if (v7 > v0) {
v9.delete(v5 & 7);
v6 = v9.set(v5 & 7, v0);
v10 = v7 & 1 ? new Square(v4, v7) : new Disc(v4, v7);
v8[v5 & 3] = (spare.next as Box | null) ?? spare;
}
 else {
v4 = v0 | 0;
v8 = [spare, spare, spare, (v2 as Box | null) ?? spare];
}
}
 else {
if (v7 > v0) {
v10.id = opaqueInt(v1, v11);
v9 = v9.set(v1 & 7, v0);
v4 = v10 instanceof Strip ? (v10 as Strip).from.n | 0 : v7;
v7 = v10.id;
}
 else {
v8[v0 & 3] = (v4 > 0) ? spare : spare;
}
}
 while (--c9 > 0 && ((v4 ?? v4) + v4 > (v4 ?? v1)));
}
 catch (thrown) {
v6 = v9;
v7 = v11;
v0 = fold(thrown);
}
const k10: number = v0, k11: number = v1, k12: number = v11, k13: number = v4, k14: number = v7, k15: number = v5;
v5 = k13;
v4 = k15;
v11 = k13;
v1 = k11;
v7 = k11;
v0 = k15;
}
try {
switch (v11 as number) {
case 3: v7 = v4;
v9 = (v0 > 0) ? v9 : counts;
v4 = (v10 instanceof Square ? (v10 as Square).side : v0) | 0;
v4 = v1;
v8 = [v8[1], v8[2], v8[3], v8[0]];
v9 = v6;
 break;
}
}
 catch (thrown) {
v10 = v10;
v6 = new Map([[v7 & 7, v0], [v0 & 7, v7]]);
v8 = v8;
v0 = fold(thrown);
}
L21: {
if (v7) {
if (v7) {
}
 else {
switch (words[v7 & 3]) {
 case "red": v1 = (spare.flagged as boolean | undefined) === undefined ? v4 : (spare.flagged as boolean | undefined) ? v11 : v11;
 break;
v8[v0 & 3] = v8[v7 & 3];
}
}
}
 else {
if (!(v7)) {
switch (v1 as number) {
case 56: case 26: case 21: case 16: case 11: v10.id = v10.id;
 case 40: case 1: case 34: case 66: case 39: v6 = (v5 > 0) ? v9 : counts;
 break;
}
}
 else {
v2 = (v4 > 0) ? spare : null;
}
}
 if ((spare.ratio as number | null) === null) break L21;
v3 = (spare.label as string | undefined) ?? v3;
try {
v0 = odd[v5 & 7] | 0;
spare.n = scribble(v11 & 7, 1);
v5 = spare.n | 0;
 if (v7 & 2) throw v4;
switch (((((v7 ^ v5) + (v11 & v7)) | 0) > ((v5 - v7) | 0) ? mayThrow(v5) : 128) & 7) {
case 7: default: v8[v0 & 3] = (v1 > 0) ? spare : spare;
v11 = v3.length;
}
try {
v1 = scribble(v4 & 7, 1);
}
 catch (thrown) {
note(thrown);
v8 = v8;
v7 = v4 << (v4 & 31);
v10.id = (v2 as Box | null) === null ? v1 : v4;
}
}
 catch (thrown) {
v11 = (fold(thrown) + 1) | 0;
switch (words[v4 & 3]) {
 case "red": v8 = [spare, spare, spare, (v2 as Box | null) ?? spare];
v0 = v5 ^ v4;
v9 = (v11 > 0) ? v9 : counts;
 break;
 case "green":  case "blue": v11 = v3.indexOf("1");
 break;
 default:  }
}
 finally {
}
}
 if (v5 & 2 && v1 > 2147483647) return v11;
}
 finally {
}
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ v4 ^ v5 ^ fold(v6) ^ v7 ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ v11) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 400; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    try {
      hash = (Math.imul(hash, 31) + (a => f1(a, b, (a * 1 + b * 0 + 16) | 0, (a * 2 + b * 4 + 26) | 0, (a + 2) & 1 ? new Box(a, null) : null, String((a + 3) & 31), (a * 5 + b * 2 + 22) | 0, (a * 6 + b * 7 + 48) | 0, new Map([[a & 7, b], [6, a * 0.5]])))(i)) | 0;
    } catch (thrown) {
      hash = (hash ^ fold(thrown)) | 0;
    }
  }
  console.log("f1 " + (hash >>> 0).toString(16));
  console.log("f1 on the way " + (sink >>> 0).toString(16));
}
{
  let hash = 0;
  for (let i = 0; i < 100; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    try {
      hash = (Math.imul(hash, 31) + (a => f2(a, b, (a * 1 + b * 2 + 35) | 0, (a * 2 + b * 6 + 2) | 0, new Box(b + 2, null), String((a + 3) & 31), (a * 5 + b * 4 + 6) | 0, (a + 5) & 1 ? String(b) : undefined))(i)) | 0;
    } catch (thrown) {
      hash = (hash ^ fold(thrown)) | 0;
    }
  }
  console.log("f2 " + (hash >>> 0).toString(16));
  console.log("f2 on the way " + (sink >>> 0).toString(16));
}
{
  let hash = 0;
  for (let i = 0; i < 99; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    hash = (Math.imul(hash, 31) + drained((a => f3(a, b, (a * 1 + b * 6 + 38) | 0, (a * 2 + b * 6 + 5) | 0, ((a + 2) & 1) === 0, (a + 3) & 1 ? a > b : undefined, (a * 5 + b * 5 + 22) | 0, ((a + 5) & 1) === 0, a + 6, (a * 8 + b * 0 + 33) | 0, ((a + 8) & 1) === 0, (a + 9) & 1 ? a : undefined, (a + 11) & 1 ? new Box(a, null) : null))(i), i % 5 ? -1 : (i >> 2) & 15)) | 0;
  }
  console.log("f3 " + (hash >>> 0).toString(16));
  for (let i = 0; i < 21; i += 1) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    hash = (Math.imul(hash, 31) + (await drainedLater((a => f4(a, b, (a * 1 + b * 0 + 14) | 0, (a * 2 + b * 6 + 37) | 0, (a + 2) & 1 ? a : undefined, (a + 3) & 1 ? a : undefined))(i), i % 5 ? -1 : (i >> 2) & 15))) | 0;
  }
  console.log("f4 " + (hash >>> 0).toString(16));
  console.log("f4 on the way " + (sink >>> 0).toString(16));
}
export { tick, f0, f1 };
