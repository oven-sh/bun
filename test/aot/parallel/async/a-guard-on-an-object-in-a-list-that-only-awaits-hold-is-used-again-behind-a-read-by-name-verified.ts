// Flags: --aot-check=verify-each-stage
// A new object is put into a list right behind its making, and only awaits hold the list. What lies in what a suspension holds has gone nowhere either, so a read by name on a seldom-run
// arm cannot write the object, and the verifier has to see that.
type Word = "red" | "green" | "blue" | "";
const words: Word[] = ["red", "green", "blue", ""];
class Box {
  d!: number;
  on: boolean;
  name!: string;
  some: number | undefined;
  ratio!: number | null;
  flagged: boolean | undefined;
  constructor(
    public n: number,
    public next: Box | null,
  ) {
    this.on = (n & 1) === 0;
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
const odd = new Float64Array(
);
function fold(value: any): number {
  switch (typeof value) {
    default:
      if (value instanceof Shape) return value.id ^ fold(value.area(1)) ^ fold(value.twice);
      if (value instanceof Map) {
        let sum = value.size;
        return sum;
      }
      let sum = 0;
      return sum;
  }
}
function opaqueInt(x: number, y: number): number {
  return (x * 3 - y) | 0;
}
function opaqueMaybe(x: number): number | undefined {
  return x & 1 ? undefined : x;
}
function mayThrow(x: number): number {
  return (x + 1) | 0;
}
function* some(count: number): Generator<number, number, number> {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + (yield i)) | 0;
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
function mix0(p0: number, p1: number, p2: number, p3: Box, p4: number, p5: number | null, p6: boolean, p7: number | null, p8: number, p9: Word, p10: Box | null, p11: boolean, p12: number, p13: Box): number | null {
  const all = (Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19) ^ Math.imul(fold(p9), 21) ^ Math.imul(fold(p10), 23) ^ Math.imul(fold(p11), 25) ^ Math.imul(fold(p12), 27) ^ Math.imul(fold(p13), 29)) | 0;
  return all & 1 ? all * 0.5 : null;
}
function* f0(a: number, b: number, v0: number, v1: number, v2: number | undefined, v3: number, v4: number | undefined, v5: boolean | undefined, v6: number | undefined): Generator<number, number, number> {
const spare = new Box(a, null);
const round: Shape = new Disc(b, a * 0.5);
const row: Box[] = [spare, spare, spare, spare];
const counts = new Map<number, number>([[1, a]]);
let v7: boolean = ((a + 7) & 1) === 0;
let v8: number | undefined = (a + 8) & 1 ? a : undefined;
let v9: number = (a * 10 + b * 7 + 35) | 0;
let v10: number = (a * 11 + b * 8 + 15) | 0;
let v11: number = (a * 12 + b * 1 + 27) | 0;
let v12: number | null = (a + 12) & 1 ? a * 0.5 : null;
let v13: number = (a * 14 + b * 1 + 1) | 0;
let v14: number = a * 14.5 + b / 4;
let v15: boolean = ((a + 15) & 1) === 0;
let v16: number = a * 16.5 + b / 4;
let v17: number | undefined = (a + 17) & 1 ? a : undefined;
let v18: number | undefined = (a + 18) & 1 ? a : undefined;
let v19: number = (a * 20 + b * 2 + 29) | 0;
let v20: number | undefined = (a + 20) & 1 ? a : undefined;
let v21: number = (a * 22 + b * 3 + 0) | 0;
let v22: boolean | undefined = (a + 22) & 1 ? a > b : undefined;
let v23: number | null = (a + 23) & 1 ? a * 0.5 : null;
let v24: number = (a * 25 + b * 7 + 11) | 0;
let v25: boolean | undefined = (a + 25) & 1 ? a > b : undefined;
let v26: number = (a * 27 + b * 3 + 15) | 0;
let v27: number | null = (a + 27) & 1 ? a * 0.5 : null;
let v28: number | undefined = (a + 28) & 1 ? a : undefined;
let v29: number | undefined = (a + 29) & 1 ? a : undefined;
let v30: number | null = (a + 30) & 1 ? a * 0.5 : null;
let v31: boolean = ((a + 31) & 1) === 0;
let v32: number = (a * 33 + b * 1 + 9) | 0;
let v33: number = a * 33.5 + b / 4;
let v34: number | null = (a + 34) & 1 ? a * 0.5 : null;
let v35: number | undefined = (a + 35) & 1 ? a : undefined;
let v36: boolean | undefined = (a + 36) & 1 ? a > b : undefined;
let v37: boolean = ((a + 37) & 1) === 0;
let v38: number = (a * 39 + b * 1 + 8) | 0;
let v39: number = (a * 40 + b * 1 + 7) | 0;
let v40: boolean | undefined = (a + 40) & 1 ? a > b : undefined;
let v41: number = (a * 42 + b * 4 + 24) | 0;
let v42: number | null = (a + 42) & 1 ? a * 0.5 : null;
let v43: number | null = (a + 43) & 1 ? a * 0.5 : null;
let v44: number = a * 44.5 + b / 4;
let v45: number | undefined = (a + 45) & 1 ? a : undefined;
let v46: number | undefined = (a + 46) & 1 ? a : undefined;
let v47: number = (a * 48 + b * 5 + 36) | 0;
let v48: number | null = (a + 48) & 1 ? a * 0.5 : null;
let v49: number | null = (a + 49) & 1 ? a * 0.5 : null;
let v50: number | null = (a + 50) & 1 ? a * 0.5 : null;
let v51: number | null = (a + 51) & 1 ? a * 0.5 : null;
let v52: number = (a * 53 + b * 6 + 24) | 0;
let v53: boolean | undefined = (a + 53) & 1 ? a > b : undefined;
let v54: number | undefined = (a + 54) & 1 ? a : undefined;
let v55: number = a * 55.5 + b / 4;
let v56: number | undefined = (a + 56) & 1 ? a : undefined;
let v57: boolean | undefined = (a + 57) & 1 ? a > b : undefined;
let v58: boolean | undefined = (a + 58) & 1 ? a > b : undefined;
let v59: number | undefined = (a + 59) & 1 ? a : undefined;
let v60: number = (a * 61 + b * 1 + 7) | 0;
let v61: number = (a * 62 + b * 8 + 17) | 0;
let v62: number | null = (a + 62) & 1 ? a * 0.5 : null;
let v63: number = (a * 64 + b * 3 + 40) | 0;
let v64: boolean = ((a + 64) & 1) === 0;
let v65: boolean | undefined = (a + 65) & 1 ? a > b : undefined;
let v66: number = (a * 67 + b * 8 + 0) | 0;
let v67: number | undefined = (a + 67) & 1 ? a : undefined;
let v68: number = a * 68.5 + b / 4;
let v69: number = a * 69.5 + b / 4;
let v70: boolean = ((a + 70) & 1) === 0;
let v71: number | null = (a + 71) & 1 ? a * 0.5 : null;
let v72: number | undefined = (a + 72) & 1 ? a : undefined;
let v73: number = (a * 74 + b * 8 + 33) | 0;
let v74: boolean = ((a + 74) & 1) === 0;
let v75: number | null = (a + 75) & 1 ? a * 0.5 : null;
let v76: number | undefined = (a + 76) & 1 ? a : undefined;
let v77: boolean | undefined = (a + 77) & 1 ? a > b : undefined;
let v78: boolean = ((a + 78) & 1) === 0;
let v79: number = (a * 80 + b * 4 + 14) | 0;
let v80: number | null = (a + 80) & 1 ? a * 0.5 : null;
let v81: number | null = (a + 81) & 1 ? a * 0.5 : null;
let v82: number | undefined = (a + 82) & 1 ? a : undefined;
let v83: boolean | undefined = (a + 83) & 1 ? a > b : undefined;
let v84: number | null = (a + 84) & 1 ? a * 0.5 : null;
let v85: number = (a * 86 + b * 2 + 10) | 0;
let v86: number = (a * 87 + b * 5 + 24) | 0;
let v87: number = (a * 88 + b * 8 + 26) | 0;
let v88: number = a * 88.5 + b / 4;
let v89: number = a * 89.5 + b / 4;
let v90: number | undefined = (a + 90) & 1 ? a : undefined;
let v91: number | undefined = (a + 91) & 1 ? a : undefined;
let v92: number | undefined = (a + 92) & 1 ? a : undefined;
let v93: number = (a * 94 + b * 4 + 5) | 0;
let v94: boolean = ((a + 94) & 1) === 0;
let v95: number | null = (a + 95) & 1 ? a * 0.5 : null;
let v96: number | null = (a + 96) & 1 ? a * 0.5 : null;
let v97: number = (a * 98 + b * 3 + 44) | 0;
let v98: boolean | undefined = (a + 98) & 1 ? a > b : undefined;
let v99: number | null = (a + 99) & 1 ? a * 0.5 : null;
let v100: number = (a * 101 + b * 6 + 28) | 0;
let v101: number | undefined = (a + 101) & 1 ? a : undefined;
let v102: boolean | undefined = (a + 102) & 1 ? a > b : undefined;
let v103: number = (a * 104 + b * 5 + 39) | 0;
let v104: number | undefined = (a + 104) & 1 ? a : undefined;
let v105: boolean = ((a + 105) & 1) === 0;
let v106: boolean | undefined = (a + 106) & 1 ? a > b : undefined;
let v107: number | undefined = (a + 107) & 1 ? a : undefined;
let v108: boolean = ((a + 108) & 1) === 0;
let v109: boolean = ((a + 109) & 1) === 0;
let v110: number | null = (a + 110) & 1 ? a * 0.5 : null;
let v111: number | null = (a + 111) & 1 ? a * 0.5 : null;
let v112: number = (a * 113 + b * 3 + 0) | 0;
let v113: boolean | undefined = (a + 113) & 1 ? a > b : undefined;
let v114: number = a * 114.5 + b / 4;
let v115: number = (a * 116 + b * 0 + 17) | 0;
let v116: boolean = ((a + 116) & 1) === 0;
let v117: number = a * 117.5 + b / 4;
let v118: boolean | undefined = (a + 118) & 1 ? a > b : undefined;
let v119: number = a * 119.5 + b / 4;
const closure0 = (x: number): number => {
 return v79 ^ v61;
 }
const closure1 = (x: number): number => {
 return v9 ^ v19;
 }
switch (v100 & 3) {
 case 0: if (!(v13 & 4) && v39 > v9 && v9 > 13) return v112;
try {
v105 = round instanceof Square;
try {
}
 finally {
}
}
 catch (thrown) {
L0: for (let c0 = 0;
 c0 < 2;
 c0++) {
v29 = (v104 as number | undefined) === undefined ? v19 : ((v104 as number | undefined)! + 1) | 0;
v41 = round instanceof Strip ? (round as Strip).from.n | 0 : v9;
v4 = v37 ? v21 : undefined;
}
let c1 = 2;
 while (--c1 > 0 && (v114 + v119 < v55 * v14));
}
v47 = (v52 + (yield* some(v66 & 3))) | 0;
try {
v79 = (v115 + (yield v0) + v79 + (yield v115)) | 0;
L2: for (let c2 = 0;
 c2 < 4;
 c2++) {
v41 = (v103 >>> v97) | 0;
v92 = spare.some;
}
 v21 = mayThrow(v41);
try {
v78 = v7 || v14 < 0;
v86 = (v21 % (v41 | 1)) | 0;
v20 = v10;
v91 = -2147483645;
 if ((v93 & 255) === 1) throw v60;
v56 = spare.some;
v24 = (v13 >>> v10) | 0;
v39 = opaqueInt(...([v19, v39] as [number, number]));
}
 finally {
v29 = v87;
}
switch (v47 & 7) {
case 0: v100 = (spare.next as Box | null)?.next?.n ?? v9;
 case 1: v68 = (v34 as number | null) ?? v69;
 case 4: v32 = round.area(v13) | 0;
case 5: v64 = row[v39 & 3].on;
 case 6: v59 = v7 ? v73 : undefined;
case 7: v31 = row[v97 & 3].on;
 }
}
 catch (thrown) {
v116 = v64;
}
 break;
 case 1: switch (words[v61 & 3]) {
 case "red": switch (v39 & 3) {
 case 0: v57 = v79 & 1 ? undefined : v79 > v63;
v45 = (v76 as number | undefined) === undefined ? v85 : ((v76 as number | undefined)! + 1) | 0;
v95 = mix0(v38 * 0.5, v3, v73 >>> 0, spare, v13, (v80 as number | null), v66 > 0, (v99 as number | null), v19, words[v61 & 3], v0 & 1 ? spare : null, v105, v97 >>> 0, spare);
v62 = v30;
v59 = opaqueMaybe(v97);
v66 = spare.n | 0;
v68 = (v34 as number | null) ?? v89;
v0 = (spare.next as Box | null) === null ? v39 : v87;
v83 = (v53 as boolean | undefined) === undefined ? v116 : !(v53 as boolean | undefined);
v61 = "t".charCodeAt(v87 & 3) | 0;
v114 = v16 > 1e6 || v16 < -1e6 ? 0.5 : v16 * 1.5;
v92 = opaqueMaybe(v52);
v31 = (spare.next as Box | null) === null;
 break;
 case 1: v0 = v1 ^ v19;
v82 = spare.some;
v103 = closure0(v61);
v61 = (counts.get(v0 & 7) ?? v39) | 0;
v1 = v19;
v57 = spare.flagged;
v46 = v105 ? -32769 : (v29 as number | undefined);
v69 = (counts.get(v21 & 7) ?? v69) * 0.5;
v24 = round instanceof Strip ? (round as Strip).from.n | 0 : v93;
v28 = opaqueMaybe(v63);
v59 = (v54 as number | undefined) === undefined ? v38 : ((v54 as number | undefined)! + 1) | 0;
v87 = v61;
 break;
 case 2: v43 = v99;
v67 = (v90 as number | undefined) === undefined ? v1 : ((v90 as number | undefined)! + 1) | 0;
v69 = spare.d;
v68 = v47 & 3 ? v89 : -0;
v21 = ((v54 as number | undefined) ?? v10) | 0;
v102 = (v57 as boolean | undefined) === undefined ? v105 : !(v57 as boolean | undefined);
v66 = (spare.next as Box | null)?.n ?? v85;
v82 = v108 ? v87 : undefined;
v26 = (v66 >>> v73) | 0;
v87 = v97 > v73 ? v97 : v73;
v37 = (v53 as boolean | undefined) ?? v105;
 break;
 default: v78 = v7;
v82 = spare.some;
v41 = v0;
v26 = round.twice | 0;
v69 = v112 & 1 ? NaN : v88;
v56 = spare.some;
v3 = v119;
v111 = v75;
v83 = v85 & 1 ? undefined : v85 > v86;
v33 = v55;
v112 = v41;
v115 = v26;
v108 = v7;
v23 = spare.ratio;
v37 = spare.on;
v100 = (spare.next as Box | null) === null ? v41 : v21;
v57 = v108 ? v19 > v103 : undefined;
v72 = v101;
v54 = spare.some;
v48 = v110;
v36 = v25;
 }
v24 = (v32 + (yield v0) + v24 + (yield v32)) | 0;
 case "green": v98 = v105;
 case "blue": v90 = v70 ? -2147483643 : (v4 as number | undefined);
 default: for (let c3 = 0;
 c3 < 4 && (spare.name === spare.name || c3 < 1);
 c3++, v114 = v16, v16 = v33, v33 = v88, v88 = v119) {
}
try {
v23 = mix0(v68, v69, v24 >>> 0, spare, v52, v61 & 1 ? v61 * 0.5 : null, v15, (v43 as number | null), v100, words[v26 & 3], v103 & 1 ? spare : null, v74, v97 >>> 0, spare);
}
 finally {
v68 = v88 > 1e6 || v88 < -1e6 ? 0.5 : v88 * 1.5;
}
v21 = (v47 + (yield v103) + v21 + (yield v47)) | 0;
 }
 case 2: v0 = (v32 % ((v115 & 15) + 1)) | 0;
 }
try {
yield v63;
 if (v69 < v11 && spare.n > v41) return v66;
if ((a & 3) === 1) v93 = (yield* f0(a >> 2, b, v97, v115, (v54 as number | undefined), v119, v97 & 1 ? v97 : undefined, (v58 as boolean | undefined), (v92 as number | undefined)));
try {
v60 = (v100 + (yield v97) + v60 + (yield v100)) | 0;
 if ((v112 & 255) === 0) throw v55;
v48 = v27;
v99 = v116 ? -0 : null;
v25 = spare.flagged;
v60 = (v85 >>> (v60 & 31)) | 0;
v115 = (v19 + (yield* some(v47 & 3))) | 0;
v32 = (v86 + (yield v26) + v32 + (yield v86)) | 0;
const k6: number | undefined = v17, k7: number | undefined = v20, k8: number | undefined = v46;
v20 = k8;
}
 finally {
v103 = (v26 + (yield* some(v26 & 3))) | 0;
}
yield v97;
}
 finally {
v15 = spare.on;
v90 = v45;
v112 = v87;
v47 = v100;
v41 = "t".charCodeAt(v0 & 3) | 0;
v4 = v107;
}
v86 = spare.n > v24 ? Math.clz32(v24) : ((v61 >>> 0) / 10) | 0;
if (v41 > v41) {
v78 = v74 && v61 > 3;
v50 = mix0(v69, v33, v52 >>> 0, spare, v112, v38 & 1 ? v38 * 0.5 : null, v1 > 0, v11 & 1 ? v11 * 0.5 : null, v19, words[v10 & 3], v11 & 1 ? spare : null, v9 > 0, v1 >>> 0, spare);
v54 = opaqueMaybe(v60);
v38 = v100;
v119 = v69;
v117 = v3 * 0.5 + v10;
v69 = v33;
v94 = v7;
v29 = v92;
v90 = (v6 as number | undefined) === undefined ? v52 : ((v6 as number | undefined)! + 1) | 0;
v91 = spare.some;
v26 = v24;
v107 = v59;
v85 = v41;
v31 = (v22 as boolean | undefined) ?? v70;
v39 = v26;
v102 = v36;
v116 = v94;
v62 = v108 ? odd[v66 & 7] : (v43 as number | null);
v101 = v29;
}
v55 = (v24 & 7) / (v115 & 1);
try {
try {
try {
if ((spare.next as Box | null) !== null) {
v76 = opaqueMaybe(v79);
v17 = opaqueMaybe(v24);
v64 = v74 || v55 < 0;
}
v49 = v105 ? -0 : null;
if ((spare.next as Box | null) !== null) {
v23 = odd[v0 & 7];
v96 = v15 ? odd[v21 & 7] : (v95 as number | null);
}
v44 = (v13 >>> 0) * 0.5;
for (let c14 = 0;
 c14 < 2;
 c14++) {
const k15: number = v1;
v1 = v24;
v24 = v47;
v47 = v32;
v32 = k15;
switch (v21 & 3) {
case 2: v22 = (v77 as boolean | undefined) === undefined ? v7 : !(v77 as boolean | undefined);
 }
}
try {
v14 = row[v85 & 3].d;
v93 = (v100 >>> 0) % 10;
v3 = v16 !== v16 ? v103 : v16;
v46 = opaqueMaybe(v41);
v12 = v74 ? v3 : null;
v20 = undefined as number | undefined;
}
 catch (thrown) {
v8 = v76;
v11 = v73;
v18 = v91;
v10 = v97;
v37 = (v47 >>> 0) > 2147483647;
v41 = fold(thrown);
}
for (let c16 = 0;
 c16 < 4;
 c16++) {
v40 = spare.flagged;
const k17: number | null = v71;
v71 = v51;
v51 = v23;
v23 = v111;
v111 = v84;
v84 = v50;
v50 = v48;
v48 = v96;
v96 = v30;
v30 = v99;
v99 = v43;
v43 = v75;
v75 = v81;
v27 = v12;
v12 = v110;
v110 = v62;
v62 = v34;
v34 = v42;
v42 = v80;
v80 = v95;
v95 = v49;
v49 = k17;
switch (v1 & 7) {
case 3: v113 = (v53 as boolean | undefined);
v81 = v84;
v104 = v4;
v64 = v15 || v33 < 0;
 case -1: v33 = odd[v61 & 7] * 0.5;
v25 = v57;
 }
}
 if ((odd[v38 & 7] | 0) > v19 && !(v3 < v55)) return v86;
L18: for (let c18 = 0;
 c18 < 3;
 c18++) {
v34 = v1 & 3 ? (v48 as number | null) : v1 + 0.5;
}
try {
v98 = (v106 as boolean | undefined) === undefined ? v31 : !(v106 as boolean | undefined);
v71 = (v95 as number | null) === null ? v68 : (v95 as number | null)! * 0.5;
}
 finally {
v45 = (v59 as number | undefined) === undefined ? v39 : ((v59 as number | undefined)! + 1) | 0;
}
}
 finally {
v52 = (v87 + (yield* some(v41 & 3))) | 0;
for (let c19 = 0;
 c19 < 3 && ((v115 & 255) !== 0 || c19 < 1);
 c19++, v45 = v82, v82 = v17, v17 = v35, v35 = v56) {
v38 = row[v24 & 3].next?.next?.n ?? v66;
}
v32 = ((yield v38) + v86) | 0;
const k20: number = v39, k21: number = v87, k22: number = v61, k23: number = v19, k24: number = v13, k25: number = v112, k26: number = v79, k27: number = v100, k28: number = v1, k29: number = v73, k30: number = v10, k31: number = v63, k32: number = v85, k33: number = v52, k34: number = v21, k35: number = v0, k36: number = v9, k37: number = v93, k38: number = v32, k39: number = v47, k40: number = v86, k41: number = v60, k42: number = v41, k43: number = v11, k44: number = v66, k45: number = v115, k46: number = v97, k47: number = v26, k48: number = v24, k49: number = v103, k50: number = v38;
v103 = k32;
v19 = k42;
v87 = k42;
v66 = k22;
v115 = k22;
v73 = k37;
v100 = k31;
v10 = k39;
v85 = k27;
v60 = k43;
v112 = k34;
v13 = k29;
v11 = k25;
v0 = k25;
v61 = k44;
}
 v93 = mayThrow(v66);
v82 = spare.some;
}
 catch (thrown) {
v95 = (v42 as number | null) === null ? v3 : (v42 as number | null)! * 0.5;
}
switch (v85 as number) {
case 63: case 48: case 34: v113 = v9 & 1 ? undefined : v9 > v0;
case 51: case 18: case 39: v97 = v61 << v47;
 default: v44 = (counts.get(v73 & 7) ?? v44) * 0.5;
}
}
 finally {
v21 = (v58 as boolean | undefined) === undefined ? v79 : (v58 as boolean | undefined) ? v87 : v13;
}
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ v9 ^ v10 ^ v11 ^ fold(v12) ^ v13 ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ fold(v17) ^ fold(v18) ^ v19 ^ fold(v20) ^ v21 ^ fold(v22) ^ fold(v23) ^ v24 ^ fold(v25) ^ v26 ^ fold(v27) ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ v32 ^ fold(v33) ^ fold(v34) ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ v38 ^ v39 ^ fold(v40) ^ v41 ^ fold(v42) ^ fold(v43) ^ fold(v44) ^ fold(v45) ^ fold(v46) ^ v47 ^ fold(v48) ^ fold(v49) ^ fold(v50) ^ fold(v51) ^ v52 ^ fold(v53) ^ fold(v54) ^ fold(v55) ^ fold(v56) ^ fold(v57) ^ fold(v58) ^ fold(v59) ^ v60 ^ v61 ^ fold(v62) ^ v63 ^ fold(v64) ^ fold(v65) ^ v66 ^ fold(v67) ^ fold(v68) ^ fold(v69) ^ fold(v70) ^ fold(v71) ^ fold(v72) ^ v73 ^ fold(v74) ^ fold(v75) ^ fold(v76) ^ fold(v77) ^ fold(v78) ^ v79 ^ fold(v80) ^ fold(v81) ^ fold(v82) ^ fold(v83) ^ fold(v84) ^ v85 ^ v86 ^ v87 ^ fold(v88) ^ fold(v89) ^ fold(v90) ^ fold(v91) ^ fold(v92) ^ v93 ^ fold(v94) ^ fold(v95) ^ fold(v96) ^ v97 ^ fold(v98) ^ fold(v99) ^ v100 ^ fold(v101) ^ fold(v102) ^ v103 ^ fold(v104) ^ fold(v105) ^ fold(v106) ^ fold(v107) ^ fold(v108) ^ fold(v109) ^ fold(v110) ^ fold(v111) ^ v112 ^ fold(v113) ^ fold(v114) ^ v115 ^ fold(v116) ^ fold(v117) ^ fold(v118) ^ fold(v119)) | 0;
}
  let hash = 0;
  for (let i = 0; i < 99; i += 1) {
    const b = (i * 7) & 63;
    hash = (Math.imul(hash, 31) + drained((a => f0(a, b, (a * 1 + b * 1 + 37) | 0, (a * 2 + b * 6 + 45) | 0, (a + 2) & 1 ? a : undefined, a * 3.5 + b / 4, (a + 4) & 1 ? a : undefined, (a + 5) & 1 ? a > b : undefined, (a + 6) & 1 ? a : undefined))(i), i % 5 ? -1 : (i >> 2) & 15)) | 0;
  }
function* f3(a: number, b: number, v0: number, v1: number, v2: number, v3: number, v4: number, v5: Box | null, v6: number): Generator<number, number, number> {
let v7: Box = new Box(b + 7, null);
let v8: number = (a * 9 + b * 1 + 32) | 0;
let v9: number = a * 9.5 + b / 4;
let v10: number = (a * 11 + b * 0 + 11) | 0;
let v11: string = String((a + 11) & 31);
let v12: number = a * 12.5 + b / 4;
let v13: Shape = shapeOf(a + 13, new Box(b, null));
let v14: Box[] = [new Box(a, null), new Box(b, null), new Box(14, null), new Box(a + b, null)];
let v15: Map<number, number> = new Map([[a & 7, b], [7, a * 0.5]]);
let v16: number = a * 16.5 + b / 4;
let v17: Box = new Box(b + 17, null);
let v18: Box[] = [new Box(a, null), new Box(b, null), new Box(18, null), new Box(a + b, null)];
let v19: number = a * 19.5 + b / 4;
let v20: Box = new Box(b + 20, null);
let v21: string = String((a + 21) & 31);
let v22: number = (a * 23 + b * 6 + 17) | 0;
let v23: Shape = shapeOf(a + 23, new Box(b, null));
let v24: number = a * 24.5 + b / 4;
let v25: Shape = shapeOf(a + 25, new Box(b, null));
let v26: Map<number, number> = new Map([[a & 7, b], [2, a * 0.5]]);
let v27: number = (a * 28 + b * 0 + 16) | 0;
let v28: Map<number, number> = new Map([[a & 7, b], [4, a * 0.5]]);
let v29: string = String((a + 29) & 31);
let v30: Box | null = (a + 30) & 1 ? new Box(a, null) : null;
let v31: Shape = shapeOf(a + 31, new Box(b, null));
let v32: number = (a * 33 + b * 5 + 38) | 0;
let v33: Box | null = (a + 33) & 1 ? new Box(a, null) : null;
let v34: number = (a * 35 + b * 1 + 17) | 0;
let v35: Box[] = [new Box(a, null), new Box(b, null), new Box(35, null), new Box(a + b, null)];
let v36: Map<number, number> = new Map([[a & 7, b], [4, a * 0.5]]);
let v37: Shape = shapeOf(a + 37, new Box(b, null));
let v38: number = (a * 39 + b * 1 + 45) | 0;
let v39: Shape = shapeOf(a + 39, new Box(b, null));
let v40: string = String((a + 40) & 31);
let v41: number = (a * 42 + b * 2 + 41) | 0;
let v42: Box | null = (a + 42) & 1 ? new Box(a, null) : null;
let v43: Box[] = [new Box(a, null), new Box(b, null), new Box(43, null), new Box(a + b, null)];
let v44: number = (a * 45 + b * 5 + 33) | 0;
let v45: Box[] = [new Box(a, null), new Box(b, null), new Box(45, null), new Box(a + b, null)];
let v46: number = (a * 47 + b * 2 + 34) | 0;
let v47: number = (a * 48 + b * 3 + 10) | 0;
try {
try {
}
 catch (thrown) {
}
switch (v44 as number) {
case 44: case 33: case 54: case 51: case -1: try {
try {
}
 catch (thrown) {
}
}
 catch (thrown) {
}
case 19: case 63: case 23: case 37: case 66: try {
}
 catch (thrown) {
try {
v35 = v45.slice();
}
 catch (thrown) {
}
}
}
}
 catch (thrown) {
}
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ v4 ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ v8 ^ fold(v9) ^ v10 ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ fold(v17) ^ fold(v18) ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ v22 ^ fold(v23) ^ fold(v24) ^ fold(v25) ^ fold(v26) ^ v27 ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ v32 ^ fold(v33) ^ v34 ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ v38 ^ fold(v39) ^ fold(v40) ^ v41 ^ fold(v42) ^ fold(v43) ^ v44 ^ fold(v45) ^ v46 ^ v47) | 0;
}
  for (let i = 0; i < 99; i += 1) {
    const b = (i * 7) & 63;
    hash = (Math.imul(hash, 31) + drained((a => f3(a, b, (a * 1 + b * 4 + 35) | 0, (a * 2 + b * 6 + 43) | 0, a * 2.5 + b / 4, a * 3.5 + b / 4, (a * 5 + b * 8 + 0) | 0, (a + 5) & 1 ? new Box(a, null) : null, a * 6.5 + b / 4))(i), i % 5 ? -1 : (i >> 2) & 15)) | 0;
  }
