// Flags: --aot-check=verify-each-pass
// A short loop reads the length and the first character of a value that is a number or a string, inside a try in two loops. The string is made flat once, ahead of the loop, under the handler of the try, which here is a finally that hands the error on.
class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
let fuse = 0;
class Blown extends Error {}
function tick(): void {
  if (fuse > 0 && --fuse === 0) throw new Blown("blown");
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueBox(x: Box, y: number): Box {
  return y & 1 ? x : new Box(y | 0, null);
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    default:
      return value === null ? 11 : value.n | 0;
  }
}
function f2(a: number, b: number): number {
let v0: number = (a * 1 + b * 6 + 48) | 0;
let v1: number = (a * 2 + b * 7 + 45) | 0;
let v2: number = a * 2.5 + b / 4;
let v3: number = (a * 4 + b * 2 + 27) | 0;
let v4: number = a * 4.5 + b / 4;
let v5: number = a * 5.5 + b / 4;
let v6: number = (a * 7 + b * 2 + 4) | 0;
let v7: string = String((a + 7) & 31);
let v8: number = a * 8.5 + b / 4;
let v9: Box = new Box(b + 9, null);
let v10: Box = new Box(b + 10, null);
let v11: number = (a * 12 + b * 1 + 17) | 0;
let v12: any = a + 12;
let v13: string = String((a + 13) & 31);
let v14: string = String((a + 14) & 31);
let v15: number = (a * 16 + b * 3 + 25) | 0;
switch (v15 & 3) {
 case 1: v10 = opaqueBox(v9, v6);
L9: for (let c9 = 0;
 c9 < 4;
 c9++) {
switch (v11 & 3) {
 case 1: try {
v12 = v13;
}
 finally {
}
try {
}
 finally {
 }
 }
}
let c11 = 4;
 L11: while (c11-- > 0) {
for (const each of [v0, v6, 6]) {
try {
let c12 = 3;
 do {
v10.n = fold(v12);
}
 while (--c12 > 0 && (typeof v12 === "string"));
}
 finally {
v1 = opaqueInt(v15, v15);
}
}
}
 default:  }
return (v0 ^ v1 ^ fold(v2) ^ v3 ^ fold(v4) ^ fold(v5) ^ v6 ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ v11 ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ v15) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 400; i++) hash = (Math.imul(hash, 31) + f2(i, (i * 7) & 63)) | 0;
  console.log((hash >>> 0).toString(16));
}