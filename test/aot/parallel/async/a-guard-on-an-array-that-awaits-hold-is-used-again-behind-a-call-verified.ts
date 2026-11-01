// Flags: --aot-check=verify-each-stage
// An array made in an async function lives across many awaits. The test of its storage stands in front of a short loop, and the seldom-run copy of the loop calls
// the constructor of Box between two uses of that test. What an await holds has gone nowhere, so the call cannot write the array, and the verifier has to see that.
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
    this.ratio = n & 4 ? n * 0.25 : null;
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
function fold(value: any): number {
  switch (typeof value) {
    default:
      if (value instanceof Shape) return value.id ^ fold(value.area(1)) ^ fold(value.twice);
      let sum = 0;
      return sum;
  }
}
function opaqueInt(x: number, y: number): number {
  return (x * 3 - y) | 0;
}
function opaqueBox(x: Box, y: number): Box {
  return y & 1 ? x : new Box(y | 0, null);
}
async function later(x: number): Promise<number> {
  return (x + 1) | 0;
}
async function laterOrNever(x: number): Promise<number> {
  return (x + 1) | 0;
}
async function* someLater(count: number): AsyncGenerator<number, number, unknown> {
  return count;
}
function settled(result: PromiseSettledResult<number>): number {
  return result.status === "fulfilled" ? result.value : fold(result.reason) + 1;
}
async function f0(a: number, b: number, v0: number, v1: number, v2: number, v3: Shape, v4: Map<number, number>, v5: Shape, v6: Shape, v7: Map<number, number>, v8: Box[], v9: number, v10: number, v11: Box | null): Promise<number> {
const spare = new Box(a, null);
let sunk = false;
let v12: Shape = shapeOf(a + 12, new Box(b, null));
let v13: Shape = shapeOf(a + 13, new Box(b, null));
let v14: Box = new Box(b + 14, null);
let v15: Box = new Box(b + 15, null);
let v16: Shape = shapeOf(a + 16, new Box(b, null));
let v17: number = (a * 18 + b * 6 + 28) | 0;
let v18: Map<number, number> = new Map([[a & 7, b], [2, a * 0.5]]);
let v19: string = String((a + 19) & 31);
let v20: string = String((a + 20) & 31);
let v21: string = String((a + 21) & 31);
let v22: Shape = shapeOf(a + 22, new Box(b, null));
let v23: string = String((a + 23) & 31);
let v24: Box | null = (a + 24) & 1 ? new Box(a, null) : null;
let v25: Shape = shapeOf(a + 25, new Box(b, null));
let v26: Map<number, number> = new Map([[a & 7, b], [2, a * 0.5]]);
let v27: number = (a * 28 + b * 0 + 3) | 0;
let v28: Map<number, number> = new Map([[a & 7, b], [4, a * 0.5]]);
let v29: Box = new Box(b + 29, null);
let v30: string = String((a + 30) & 31);
let v31: Box = new Box(b + 31, null);
let v32: Map<number, number> = new Map([[a & 7, b], [0, a * 0.5]]);
let v33: string = String((a + 33) & 31);
let v34: Box | null = (a + 34) & 1 ? new Box(a, null) : null;
let v35: number = (a * 36 + b * 3 + 13) | 0;
let v36: Shape = shapeOf(a + 36, new Box(b, null));
let v37: number = (a * 38 + b * 8 + 37) | 0;
let v38: Box | null = (a + 38) & 1 ? new Box(a, null) : null;
let v39: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
let v40: Map<number, number> = new Map([[a & 7, b], [0, a * 0.5]]);
let v41: string = String((a + 41) & 31);
let v42: Box[] = [new Box(a, null), new Box(b, null), new Box(42, null), new Box(a + b, null)];
let v43: Shape = shapeOf(a + 43, new Box(b, null));
let v44: Box | null = (a + 44) & 1 ? new Box(a, null) : null;
let v45: Shape = shapeOf(a + 45, new Box(b, null));
let v46: Map<number, number> = new Map([[a & 7, b], [6, a * 0.5]]);
let v47: number = (a * 48 + b * 5 + 8) | 0;
const closure0 = (x: number): number => {
 return v1 ^ v9;
 }
v0 = (v10 + (await v37)) | 0;
for (let c3 = 0;
 c3 < 4;
 c3++) {
const k4: Box = v15;
v15 = v14;
v14 = v31;
v31 = v29;
v29 = k4;
}
switch (v1 & 3) {
 case 0: if ((v35 & 255) === 2) {
L5: for (let c5 = 0;
 c5 < 2;
 c5++) {
switch (words[v37 & 3]) {
 case "red": v0 = opaqueInt(v47, v37);
v20 = `${
v2 & 3}
`;
 }
}
switch (words[v35 & 3]) {
 case "red": for (const each of [v2, v2, 2]) {
}
try {
}
 catch (thrown) {
v20 = `${
v10 & 7}
`.slice(-7);
}
for (let c20 = 0;
 c20 < 5;
 c20++) {
for await (const each of someLater(v2 & 3)) v35 = (v35 + each) | 0;
}
 case "green": try {
}
 catch (thrown) {
}
try {
}
 catch (thrown) {
}
 }
}
let c32 = 1;
 L32: while (c32-- > 0) {
v26.delete(v2 & 7);
for await (const each of someLater(v35 & 3)) v2 = (v2 + each) | 0;
}
 break;
case 3: ({
 n: v10, on: sunk }
 = v14);
v17 = v10;
switch (v10 as number) {
 default: v37 = (v24 as Box | null)?.n ?? v35;
}
L54: for (let c54 = 0;
 c54 < 5;
 c54++) {
v42[v0 & 3] = v42[v10 & 3];
v42[v35 & 3] = (v37 > 0) ? ((v31.next as Box | null) ?? spare) : opaqueBox(v31, v17);
}
for (let c55 = 0;
 c55 < 4;
 c55++) {
}
v27 = (v47 + (await later(v9)) + Math.imul(v27, await later(v47))) | 0;
 case 6: v10 = (v47 + (await v35)) | 0;
try {
for await (const each of someLater(v37 & 3)) v47 = (v47 + each) | 0;
v37 = (v2 + (await v17)) | 0;
for (const each of [v2, v27, 7]) {
}
try {
}
 finally {
}
for await (const each of someLater(v17 & 3)) v17 = (v17 + each) | 0;
}
 finally {
[v9, v47] = await Promise.all([later(v9), later(v27)]);
}
v2 = await laterOrNever(v9);
 case 2: try {
if (v41 < "k") {
if (v41 < "k") {
v37 = v37 < v2 ? ((v14.some as number | undefined) ?? v0) | 0 : v47 | 0;
}
}
try {
}
 catch (thrown) {
}
}
 catch (thrown) {
v9 = fold(thrown);
}
 default:  }
return (v0 ^ v1 ^ v2 ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ v9 ^ v10 ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ v17 ^ fold(v18) ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ fold(v23) ^ fold(v24) ^ fold(v25) ^ fold(v26) ^ v27 ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ fold(v32) ^ fold(v33) ^ fold(v34) ^ v35 ^ fold(v36) ^ v37 ^ fold(v38) ^ fold(v39) ^ fold(v40) ^ fold(v41) ^ fold(v42) ^ fold(v43) ^ fold(v44) ^ fold(v45) ^ fold(v46) ^ v47) | 0;
}
  let hash = 0;
  for (let i = 0; i < 99; i += 3) {
    const b = (i * 7) & 63;
    for (const each of await Promise.allSettled([(a => f0(a, b, (a * 1 + b * 2 + 22) | 0, (a * 2 + b * 3 + 3) | 0, (a * 3 + b * 5 + 41) | 0, shapeOf(a + 3, new Box(b, null)), new Map([[a & 7, b], [4, a * 0.5]]), shapeOf(a + 5, new Box(b, null)), shapeOf(a + 6, new Box(b, null)), new Map([[a & 7, b], [7, a * 0.5]]), [new Box(a, null), new Box(b, null), new Box(8, null), new Box(a + b, null)], (a * 10 + b * 7 + 25) | 0, (a * 11 + b * 0 + 37) | 0, (a + 11) & 1 ? new Box(a, null) : null))(i), (a => f0(a, b, (a * 1 + b * 5 + 5) | 0, (a * 2 + b * 0 + 43) | 0, (a * 3 + b * 3 + 35) | 0, shapeOf(a + 3, new Box(b, null)), new Map([[a & 7, b], [4, a * 0.5]]), shapeOf(a + 5, new Box(b, null)), shapeOf(a + 6, new Box(b, null)), new Map([[a & 7, b], [7, a * 0.5]]), [new Box(a, null), new Box(b, null), new Box(8, null), new Box(a + b, null)], (a * 10 + b * 4 + 38) | 0, (a * 11 + b * 3 + 14) | 0, (a + 11) & 1 ? new Box(a, null) : null))(i + 1), (a => f0(a, b, (a * 1 + b * 3 + 15) | 0, (a * 2 + b * 5 + 8) | 0, (a * 3 + b * 2 + 31) | 0, shapeOf(a + 3, new Box(b, null)), new Map([[a & 7, b], [4, a * 0.5]]), shapeOf(a + 5, new Box(b, null)), shapeOf(a + 6, new Box(b, null)), new Map([[a & 7, b], [7, a * 0.5]]), [new Box(a, null), new Box(b, null), new Box(8, null), new Box(a + b, null)], (a * 10 + b * 2 + 29) | 0, (a * 11 + b * 5 + 36) | 0, (a + 11) & 1 ? new Box(a, null) : null))(i + 2)])) hash = (Math.imul(hash, 31) + settled(each)) | 0;
  }
console.log("built");
