// Two variables of type `number | null`, both null, are swapped in a loop of a function with fifty variables. Built as the cold code of a very large program is (see the .json beside this file).
// Found by ../../fuzz/values-across-joins.ts and cut down by its reducer: code that is made without optimizing gave a join two places in the frame, kept the second, and shared that one with a
// value that was still alive where the join is written: the null came back as a number. The output is that of plain Bun.
type Word = "red" | "green" | "blue" | "";
const words: Word[] = ["red", ""];
class Box {
  d: number;
  w: number;
  u: number;
  on: boolean;
  tag: Word;
  name: string;
  ratio: number | null;
  constructor(
    public n: number,
    public next: Box | null,
  ) {
    this.d = this.w = 7;
    this.u = n >>> 0;
    this.on = 0 === 0;
    this.tag = words[n & 3];
    this.name = "b";
    this.ratio = n & 4 ? n * 0.25 : null;
  }
}
const odd = new Float64Array;
function tick(): void {
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    default:
      let sum = 0;
      return sum;
  }
}
function opaqueInt(x: number, y: number): number {
  tick();
  return x * 3 - y| 0;
}
function mix3(p0: Word, p1: Box | null, p2: number, p3: number, p4: number, p5: boolean, p6: number, p7: number, p8: number, p9: number, p10: number | null, p11: number, p12: number, p13: number): number {
  const all = Math.imul(fold(p0), 3) ^ Math.imul(fold(p1), 5) ^ Math.imul(fold(p2), 7) ^ Math.imul(fold(p3), 9) ^ Math.imul(fold(p4), 11) ^ Math.imul(fold(p5), 13) ^ Math.imul(fold(p6), 15) ^ Math.imul(fold(p7), 17) ^ Math.imul(fold(p8), 19) ^ Math.imul(fold(p9), 21) ^ Math.imul(fold(p10), 23) ^ Math.imul(fold(p11), 25) ^ Math.imul(fold(p12), 27) ^ Math.imul(fold(p13), 29)| 0;
  return all * 0.125;
}
function f0(a: number, b: number, v0: number, v1: number, v2: number | null, v3: number | undefined): number {
if (a === 7) return opaqueInt(a, b);
const spare = new Box(a, null);
let v4: number | undefined = 0 & 1 ? a : undefined;
let v5: number | null = 0 & 1 ? a * 0.5 : null;
let v6: number | null = 0 & 1 ? a * 0.5 : null;
let v7: number | null = 0 & 1 ? a * 0.5 : null;
let v8: number = a / 4;
let v9: number | undefined;
let v10= 0 & 1 ? a > b : undefined;
let v11: number | null = 0 & 1 ? a * 0.5 : null;
let v12: boolean | undefined = 0 & 1 ? a > b : undefined;
let v13: number = 0 | 0;
let v14: boolean = 0 === 0;
let v15: number | undefined = 0 & 1 ? a : undefined;
let v16= 0 & 1 ;
let v17: number = 0 | 0;
let v18= 0 & 1 ;
let v19: number | undefined = 0 & 1 ? a : undefined;
let v20: boolean = 0 === 0;
let v21: number | undefined = 0 & 1 ? a : undefined;
let v22: boolean | undefined = 0 & 1 ? a > b : undefined;
let v23: number = 4;
let v24;
let v25: null = null;
let v26= a ? a > b : undefined;
let v27: boolean = 0 === 0;
let v28= a ;
let v29: undefined;
let v30= 0 === 0;
let v31: undefined;
let v32= 0 ? a : null;
let v33: boolean = 0 === 0;
let v34= a ;
let v35: number = 0;
let v36= 0 ? a : null;
let v37: undefined;
let v38= a / 4;
let v39: number | undefined = 1 ? a : undefined;
let v40= 0 === 0;
let v41: number = 0;
let v42: number | undefined = 0 ? a : undefined;
let v43: number = 4;
let v44= a ;
let v45: number | undefined = 1 ? a : undefined;
let v46: number | undefined = 0 ? a : undefined;
let v47: number | undefined = 1 ? a : undefined;
const closure0 = (): number => {
 return v35 ^ v17;
 }
try {
for (const each of [v13]) {
let c1 = 2;
 do if (v0 < v17) {
v6 = odd[7];
v9 = v35;
v43 = mix3(words[v0 ], v1 & 1 ? spare : null, 0, v28, 0, v27, v0, v13, v13, v34, 0 , v41, 65536, v34);
v1 = Math.sign(v35);
}
 else if (!(v0 < v17)) v38 = v41 & 7;
while (--c1 > 0 && v26 as true);
for (const each of [v0, v0, 2]) {
const k2: number | null = v32;
v32 = v6;
v6 = k2;
v35 = opaqueInt(v35, 1);
}
try {
try {
v41 = fold(v35);
}
 catch (thrown) {
}
 if (v0 > 2147483647) return v41;
try {
}
 finally {
}
}
 finally {
switch (words[3]) {
 case "red": v3 ;
 }
}
switch (v35 & 3) {
 case 0: v13 ;
v17 = v41;
}
}
}
 catch (thrown) {
v35 = v1;
}
return v0 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ fold(v18) ^ fold(v19) ^ fold(v20) ^ fold(v21) ^ fold(v22) ^ fold(v23) ^ fold(v24) ^ fold(v25) ^ fold(v26) ^ fold(v27) ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ fold(v32) ^ fold(v33) ^ fold(v34) ^ fold(v36) ^ fold(v37) ^ fold(v38) ^ fold(v39) ^ fold(v40) ^ fold(v42) ^ fold(v43) ^ fold(v44) ^ fold(v45) ^ fold(v46) ^ fold(v47);
}
  let hash = 0;
  for (let i = 0; i < 400; i += 1) {
    const b = 63;
    try {
      hash = Math.imul(hash, 31) + (a => f0(a, b, 0, 0, 1 ? 0.5 : null, 1 ? a : undefined))(i);
    } catch (thrown) {
    }
  }
  console.log("f0 " + (hash >>> 0).toString());
