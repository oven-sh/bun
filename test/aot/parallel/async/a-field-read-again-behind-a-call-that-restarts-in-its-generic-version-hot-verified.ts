// Flags: --aot-check=verify-each-stage --aot-heat=everything-is-hot
// `v38.d` is read twice with a call of opaqueInt() between. The typed body of opaqueInt() begins again in its generic version by a call that the choice of
// calling conventions takes out of tail position, and the verifier still has to see that numbers run no code of the program there.
class Box {
  d: number;
  on: boolean;
  flagged: boolean | undefined;
  constructor(
    public n: number,
    public next: Box | null,
  ) {
    this.d = n * 0.5;
    this.on = (n & 1) === 0;
    this.flagged = n & 8 ? (n & 1) === 1 : undefined;
  }
}
abstract class Shape {
  constructor(public id: number) {}
  abstract area(k: number): number;
  get twice(): number {
    return this.id * 2;
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
}
function shapeOf(x: number, box: Box): Shape {
  return x % 3 === 0 ? new Square(x, x & 255) : x % 3 === 1 || x % 3 === -1 ? new Disc(x, x * 0.5) : new Strip(x, box, "s" + (x & 3));
}
let calls = 0;
function tick(): void {
  if (++calls % 977 === 0)
    try {
    } catch {}
}
function fold(value: any): number {
  switch (typeof value) {
    default:
      if (value instanceof Shape) return value.id ^ fold(value.area(1)) ^ fold(value.twice);
      let sum = 0;
      return sum;
  }
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueBox(x: Box, y: number): Box {
  return y & 1 ? x : new Box(y | 0, null);
}
function* some(count: number): Generator<number, number, number> {
  let sum = 0;
  return sum;
}
function drained(steps: Generator<number, number, number>, stop: number): number {
  let sum = 0;
  try {
    let step = steps.next(0);
    return (Math.imul(sum, 31) + step.value) | 0;
  } catch (thrown) {
    return (sum ^ fold(thrown)) | 0;
  }
}
function* f0(a: number, b: number, v0: number, v1: number): Generator<number, number, number> {
let sunk = false;
let v2: Box[] = [new Box(a, null), new Box(b, null), new Box(2, null), new Box(a + b, null)];
let v3: Map<number, number> = new Map([[a & 7, b], [3, a * 0.5]]);
let v4: Shape = shapeOf(a + 4, new Box(b, null));
let v5: Map<number, number> = new Map([[a & 7, b], [5, a * 0.5]]);
let v6: Box[] = [new Box(a, null), new Box(b, null), new Box(6, null), new Box(a + b, null)];
let v7: string = String((a + 7) & 31);
let v8: Shape = shapeOf(a + 8, new Box(b, null));
let v9: Box = new Box(b + 9, null);
let v10: number = (a * 11 + b * 3 + 4) | 0;
let v11: Shape = shapeOf(a + 11, new Box(b, null));
let v12: Box | null = (a + 12) & 1 ? new Box(a, null) : null;
let v13: Box[] = [new Box(a, null), new Box(b, null), new Box(13, null), new Box(a + b, null)];
let v14: Box | null = (a + 14) & 1 ? new Box(a, null) : null;
let v15: string = String((a + 15) & 31);
let v16: Map<number, number> = new Map([[a & 7, b], [0, a * 0.5]]);
let v17: Box | null = (a + 17) & 1 ? new Box(a, null) : null;
let v18: number = (a * 19 + b * 4 + 21) | 0;
let v19: Box = new Box(b + 19, null);
let v20: Shape = shapeOf(a + 20, new Box(b, null));
let v21: number = a * 21.5 + b / 4;
let v22: Box[] = [new Box(a, null), new Box(b, null), new Box(22, null), new Box(a + b, null)];
let v23: number = a * 23.5 + b / 4;
let v24: string = String((a + 24) & 31);
let v25: Shape = shapeOf(a + 25, new Box(b, null));
let v26: number = (a * 27 + b * 5 + 13) | 0;
let v27: Box[] = [new Box(a, null), new Box(b, null), new Box(27, null), new Box(a + b, null)];
let v28: number = (a * 29 + b * 0 + 36) | 0;
let v29: Box[] = [new Box(a, null), new Box(b, null), new Box(29, null), new Box(a + b, null)];
let v30: number = (a * 31 + b * 0 + 21) | 0;
let v31: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
let v32: number = (a * 33 + b * 5 + 10) | 0;
let v33: Shape = shapeOf(a + 33, new Box(b, null));
let v34: Box = new Box(b + 34, null);
let v35: Box[] = [new Box(a, null), new Box(b, null), new Box(35, null), new Box(a + b, null)];
let v36: Map<number, number> = new Map([[a & 7, b], [4, a * 0.5]]);
let v37: Box[] = [new Box(a, null), new Box(b, null), new Box(37, null), new Box(a + b, null)];
let v38: Box = new Box(b + 38, null);
let v39: number = (a * 40 + b * 8 + 16) | 0;
let v40: string = String((a + 40) & 31);
let v41: Shape = shapeOf(a + 41, new Box(b, null));
let v42: string = String((a + 42) & 31);
let v43: Shape = shapeOf(a + 43, new Box(b, null));
let v44: Box[] = [new Box(a, null), new Box(b, null), new Box(44, null), new Box(a + b, null)];
let v45: Shape = shapeOf(a + 45, new Box(b, null));
let v46: Map<number, number> = new Map([[a & 7, b], [6, a * 0.5]]);
let v47: string = String((a + 47) & 31);
let c0 = 3;
 L0: while (c0-- > 0) {
try {
}
 catch (thrown) {
}
if (v26 < 0 || v10 < 0) {
v23 = v38.d;
v9.d = v29[v39 & 3].d;
v1 = opaqueInt(v28, 1);
v21 = v38.d;
L1: for (let c1 = 0;
 c1 < 2;
 c1++) {
}
}
try {
}
 finally {
}
v18 = (v10 + (yield* some(v28 & 3))) | 0;
try {
try {
try {
}
 finally {
try {
}
 finally {
}
}
}
 catch (thrown) {
}
for (let c7 = 0;
 c7 < 4;
 c7++) {
}
try {
for (let c13 = 0;
 c13 < 3 && (v23 * 0.5 + v26 > v30 / 3 - v30 || c13 < 1);
 c13++, v4 = v11, v11 = v25) {
}
}
 catch (thrown) {
try {
}
 finally {
}
}
switch (v39 & 15) {
case 0: v19.flagged = (v9.flagged as boolean | undefined);
({
 n: v32, on: sunk }
 = v34);
}
switch (v1 & 3) {
 default: if (v18 > v1 && v1 > 11) {
}
v38 = opaqueBox(v9, v28);
 }
for (let c18 = 0;
 c18 < 2 && ((v0 >>> 0) > (v1 >>> 0) || c18 < 1);
 c18++, v28 = v26, v26 = v18, v18 = v32, v32 = v39, v39 = v30, v30 = v1, v1 = v0, v0 = v10) {
}
}
 catch (thrown) {
}
}
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ v10 ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ fold(v17) ^ v18 ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ fold(v23) ^ fold(v24) ^ fold(v25) ^ v26 ^ fold(v27) ^ v28 ^ fold(v29) ^ v30 ^ fold(v31) ^ v32 ^ fold(v33) ^ fold(v34) ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ fold(v38) ^ v39 ^ fold(v40) ^ fold(v41) ^ fold(v42) ^ fold(v43) ^ fold(v44) ^ fold(v45) ^ fold(v46) ^ fold(v47)) | 0;
}
  let hash = 0;
  for (let i = 0; i < 21; i += 1) {
    const b = (i * 7) & 63;
    hash = (Math.imul(hash, 31) + drained((a => f0(a, b, (a * 1 + b * 3 + 26) | 0, (a * 2 + b * 4 + 20) | 0))(i), i % 5 ? -1 : (i >> 2) & 15)) | 0;
  }
console.log(hash);
