// A generator switches on a string out of an array while a number waits in a register. Every function is made without optimizing and every prediction fails (see the .json beside this file).
// Found by ../../fuzz/values-across-joins.ts and cut down by its reducer: on the general road the case "red" stands right behind the switch's compares and took the moves that are made
// on the way to the default case for made: the number came back as the bits the string is compared by. The output is that of plain Bun.
// Flags: --aot-testing=FailPredictions:1:1
type Word = "red" | "green" | "blue" | "";
const words: Word[] = ["red", ""];
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
    this.w = n ;
    this.u = n >>> 0;
    this.on = 0 === 0;
    this.tag = words[n & 3];
    this.name = "b";
    this.ratio = n & 4 ? n * 0.25 : null;
  }
}
function fold(value: any): number {
  switch (typeof value) {
    case "undefined":
      return 7;
    default:
      if (value === null) return 11;
      if (value instanceof Box) return foldBox(value) ^ 0 ;
      let sum = 0;
      for (let i = 0; i < value.length; i++) sum = Math.imul(sum, 31) | 0;
      return sum;
  }
}
function foldBox(box: Box): number {
  return box.n ^ fold(box.d) ^ fold(box.w) ^ fold(box.u) ^ fold(box.on) ^ fold(box.tag) ^ fold(box.name) ^ fold(box.some) ^ fold(box.ratio) ^ fold(box.flagged) ^ fold(box.label);
}
function drained(steps: Generator<number, number, number>, stop: number): number {
  let sum = 0;
  try {
    let step = steps.next();
    return Math.imul(sum, 31) + step.value| 0;
  } catch (thrown) {
    return sum ^ fold(thrown)| 0;
  }
}
function* f2(a: number, b: number): Generator<number> {
const spare = new Box(a, null);
let v0: number = 0 | 0;
let v1: number = 0 | 0;
let v2: number ;
let v3: number = 0 | 0;
let v4= 0 & 1 ? a * 0.5 : null;
let v5: number = 0 | 0;
let v6: boolean | undefined = 0 & 1 ? a > b : undefined;
let v7: number = a * 4;
let v8= 0 & 1 ? a * 0.5 : null;
let v9: number | null = 0 & 1 ? a * 0.5 : null;
let v10: number = a * 11 ;
let v11: number = 0 | 0;
if (spare === spare) {
const k0: number = v10;
L1: for (let c1 = 0;
 c1 < 3;
 c1++) {
if ("k" < "k") {
}
L2: for (let c2 = 0;
 c2 < 2;
 c2++) v8 = v8 === null ? v7 : 0 ! * 0.5;
v10 = fold(v10);
switch (words[v5 & 3]) {
 case "red": if ((v5 | 0) >= v3) break L1;
let c3 = 2;
v10 = (words[1] as Word).length;
 case "green": switch (v0 as any) {
case 15: case 12: case 11: case 22: v9 = 0 ;
}
 case "blue": v5 = v0 / 4294967296| 0;
 default: try {
}
 finally {
}
 }
}
}
return v0 ^ v3 ^ fold(v4) ^ v5 ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ v10 ^ v11| 0;
}
  let hash = 0;
  for (let i = 0; i < 21; i += 1) {
    const b = 0 ;
    hash = Math.imul(hash, 31) + drained((a => f2(a, b))(i), i % 5 ? -1 : 0 )| 0;
  }
  console.log("f2 " + (hash >>> 0).toString());
