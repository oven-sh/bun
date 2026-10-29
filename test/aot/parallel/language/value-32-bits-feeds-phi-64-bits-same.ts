// Sixteen variables of several kinds live at once, under switches that fall through, labeled blocks, loops and try | catch | finally: more values than registers, so most live in the frame.
// Found by ../../fuzz/many-live-values.ts and cut down by its reducer: code that is made without optimizing let a value of 32 bits and the 64-bit join it feeds share a slot of the frame and
// left out the copy between them: the high half of the slot was what the call before had left there. The output is that of plain Bun.
class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
function opaqueInt(x: number, y: number){
  return 0;
}
function opaqueBox(x: Box, y: number){
  return x;
}
function fold(value: any){
  switch (typeof value) {
    default:
      return value === null ? 11 : value.n | 0;
  }
}
  let hash = 0;
  console.log("f0 " + (0).toString(16));
function f1(a: number, b: number){
let v0: number = a * 1 + b * 0 + 32| 0;
let v1: number = a * 2 ;
let v2: any = 2;
let v3= a / 4;
let v4: string = String(4& 31);
let v5: Box = new Box(b , null);
let v6= a ;
let v7: number = a * 8 + 3| 0;
let v8: string = String(a );
let v9: number = a * 10 ;
let v10: number = 0;
let v11= new Box(b + 11, null);
let v12: number = 4;
let v13= String(a );
let v14= a * 15 + b ;
let v15: Box = new Box(b , null);
if (v4 < "k") v11.n = opaqueInt(v9, v1);
else v9 = v8 < "k" ? v9| 0 : 1;
switch (v9 & 3) {
 case 0: try {
L0: {
L1: {
v2 = v14 > 0;
v0 = v3 * 3| 0;
v10 = v4.length;
 if (v11.n > v14) break L1;
switch (v7 ) {
 case 0: v2 = v10 ? v10 : v8;
 break;
 case 1: v1| 0;
v14 = v9 ? v7 : v9;
 case 2: v1 = fold(v6);
 }
}
try {
}
 finally {
v11 = new Box(v7, null);
}
 if (v1 !== 48) break L0;
try {
try {
 if (v3 < v10) throw v7;
}
 catch (thrown) {
v1 = ((thrown as number) ) + 1;
v5 = opaqueBox(v15, v0);
}
if (v13 < "k") {
}
}
 catch (thrown) {
v9 = ((thrown as number) | 0) + 1;
v13 = `${
v8.slice(0, 3)}
`;
}
}
switch (v10 & 3) {
 case 0: try {
try {
}
 finally {
}
v13 < "k" ? 0 : Math.imul(v0, v7);
}
 finally {
}
if (v9 && v1 ) L4: for (let c4 = 0;
 c4 < 2;
 c4++) {
}
else try {
 if (v10) throw v1;
}
 finally {
v11 = new Box(v10, null);
}
try {
}
 catch (thrown) {
}
 break;
 case 1: L7: for (const each of [v1, v9, 4]) v7 = v7 > 0? v7 : v0;
L9: {
let c10 = 1;
 while (--c10 > 0 );
 if (v14 > v9 && 14) break L9;
try {
}
 catch (thrown) {
}
for (let c11 = 0;
 c11 ;
 c11++) {
}
`${
v13.slice(0, 3)}
`;
v1 = (v9 ) + 10}
 default:  }
}
 finally {
v15.n = v5.n | 0}
 }
return v1 ^ fold(v2) ^ (v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ v7 ^ fold(v8) ^ v9 ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ v14 ^ fold(v15)| 0}
{
  hash = 0;
  for (let i = 0; i < 100; i++) hash = Math.imul(hash, 31) + f1(i, i * 63);
  console.log("f1 " + (hash >>> 0).toString())}
