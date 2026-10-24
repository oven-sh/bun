// An async function with forty variables of several kinds, all live around a loop: at the end of a block two dozen values are handed to the joins of the next at once.
// Found by ../../fuzz/many-live-values.ts and cut down by its reducer: code that is made without optimizing loaded the values that another copy would overwrite into registers ahead of
// the stores, more of them than there are registers, and loaded those that were pushed out again behind the store that had overwritten them. The output is that of plain Bun.
class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
async function opaqueLater(x: number): Promise<number> {
  return (x + 1) | 0;
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return value ? 3 : 5;
    case "undefined":
      return 7;
    default:
      return value === null ? 11 : value.n | 0;
  }
}
async function f3(a: number, b: number): Promise<number> {
let v0: number = (a * 1 + b * 0 + 35) | 0;
let v1: number = (a * 2 + b * 2 + 1) | 0;
let v2: number = 0 | 0;
let v3: any = undefined;
let v4: Box = new Box(b + 4, null);
let v5: string = String((a + 5) & 31);
let v6: Box = new Box(b + 6, null);
let v7: Box = new Box(b + 7, null);
let v8: number = 0 | 0;
let v9: string = String((a + 9) & 31);
let v10: Box = new Box(b + 10, null);
let v11: boolean = ((a + 11) & 1) === 0;
let v12: Box = new Box(b + 12, null);
let v13: any = a + 13;
let v14: Box = new Box(b + 14, null);
let v15: any = a + 15;
let v16: number = a * 16.5 + b / 4;
let v17: Box = new Box(b + 17, null);
let v18: number = (a * 19 + b * 6 + 5) | 0;
let v19: string = String((a + 19) & 31);
let v20: any = null;
let v21: number = 0 | 0;
let v22: Box = new Box(b + 22, null);
let v23: number = (a * 24 + b * 2 + 13) | 0;
let v24: number = (a * 25 + b * 6 + 4) | 0;
let v25: string = String((a + 25) & 31);
let v26: number = a * 26.5 + b / 4;
let v27: number = a * 27.5 + b / 4;
let v28: number = (a * 29 + b * 7 + 31) | 0;
let v29: Box = new Box(b + 29, null);
let v30: number = a * 30.5 + b / 4;
let v31: string = String((a + 31) & 31);
let v32: string = String((a + 32) & 31);
let v33: number = (a * 34 + b * 1 + 28) | 0;
let v34: number = (a * 35 + b * 5 + 10) | 0;
let v35: number = (a * 36 + b * 7 + 38) | 0;
let v36: number = a * 36.5 + b / 4;
let v37: Box = new Box(b + 37, null);
let v38: number = (a * 39 + b * 5 + 40) | 0;
let v39: number = a * 39.5 + b / 4;
const closure0 = (x: number): number => {
 return v34 ^ v8;
 }
let c0 = 3;
 do {
for (const each of [v18, v28, 1]) {
v24 = (v28 + each) | 0;
v8 = await opaqueLater(v35);
try {
v16 = Math.floor(v36) + 0.25;
v36 = -v30;
try {
try {
}
 finally {
v4.n = (v18 & v28) | 1;
v20 = v25;
}
}
 finally {
 switch (v23 & 3) {
 case 0: v2 = (v0 + v0) | 0;
 case 2: v9 = v31.slice(1) + "q";
 }
 }
try {
}
 catch (thrown) {
}
 finally {
 switch (v38 & 3) {
 case 1: v29 = new Box(v23, null);
 case 2: v39 = v26 * 0;
 default: v25 = (v9 + v9.length).slice(-4);
 }
 }
}
 catch (thrown) {
v0 = ((thrown as number) | 0) + 1;
v3 = v11;
}
v33 = (v39 * 3) | 0;
if (v1 > v24 && v24 > 19) {
v31 = (v31 + "a").slice(-6);
try {
v28 = v31.length;
v6 = new Box(v28, null);
}
 finally {
 }
}
}
v35 = (v21 + v28) | 0;
}
 while (--c0 > 0 && (v18 > v1));
return (v0 ^ v1 ^ v2 ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ v8 ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) ^ fold(v16) ^ fold(v17) ^ v18 ^ fold(v19) ^ fold(v20) ^ v21 ^ fold(v22) ^ v23 ^ v24 ^ fold(v25) ^ fold(v26) ^ fold(v27) ^ v28 ^ fold(v29) ^ fold(v30) ^ fold(v31) ^ fold(v32) ^ v33 ^ v34 ^ v35 ^ fold(v36) ^ fold(v37) ^ v38 ^ fold(v39)) | 0;
}
  let hash = 0;
  for (let i = 0; i < 100; i++) hash = (Math.imul(hash, 31) + (await f3(i, (i * 7) & 63))) | 0;
  console.log("f3 " + (hash >>> 0).toString(16));
