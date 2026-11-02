// 16 of int+double . async 40 of int+any+box+text+double+flag . 40 of int+double
// Flags: --aot-heat=everything-is-cold
class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
let calls = 0;
function tick(): void {
  if (++calls % 977 === 0)
    try {
      throw calls;
    } catch {}
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueDouble(x: number, y: number): number {
  tick();
  return x * 0.75 + y;
}
function opaqueText(x: string, y: number): string {
  tick();
  return (x + (y & 7)).slice(-5);
}
function opaqueBox(x: Box, y: number): Box {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
async function opaqueLater(x: number): Promise<number> {
  tick();
  return (x + 1) | 0;
}
function opaqueAny(x: any): any {
  tick();
  return x;
}
function drained(steps: Generator<number, number, number>): number {
  let sum = 0;
  for (let step = steps.next(0); ; step = steps.next(sum & 7)) {
    sum = (Math.imul(sum, 31) + step.value) | 0;
    if (step.done) return sum;
  }
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : (value * 1000) | 0;
    case "boolean":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    case "undefined":
      return 7;
    default:
      return value === null ? 11 : value.n | 0;
  }
}

function f0(a: number, b: number): number {
const spare = new Box(a, null);
let v0: number = (a * 1 + b * 3 + 44) | 0;
let v1: number = (a * 2 + b * 4 + 46) | 0;
let v2: number = (a * 3 + b * 2 + 45) | 0;
let v3: number = (a * 4 + b * 3 + 38) | 0;
let v4: number = (a * 5 + b * 6 + 46) | 0;
let v5: number = a * 5.5 + b / 4;
let v6: number = a * 6.5 + b / 4;
let v7: number = (a * 8 + b * 2 + 26) | 0;
let v8: number = a * 8.5 + b / 4;
let v9: number = (a * 10 + b * 4 + 45) | 0;
let v10: number = a * 10.5 + b / 4;
let v11: number = a * 11.5 + b / 4;
let v12: number = a * 12.5 + b / 4;
let v13: number = a * 13.5 + b / 4;
let v14: number = a * 14.5 + b / 4;
let v15: number = (a * 16 + b * 5 + 47) | 0;
v2 = (v4 + 95) | 0;
for (const each of [v7, v7, 5]) {
v7 = (v1 + each) | 0;
if (v2 < v4 && v9 < 0 || v7 < 0) return v3;
v11 = -v11;
}
return (v0 ^ v1 ^ v2 ^ v3 ^ v4 ^ fold(v5) ^ fold(v6) ^ v7 ^ fold(v8) ^ v9 ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ v15) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 100; i++) hash = (Math.imul(hash, 31) + f0(i, (i * 7) & 63)) | 0;
  console.log("f0 " + (hash >>> 0).toString(16));
}

async function f1(a: number, b: number): Promise<number> {
const spare = new Box(a, null);
let v0: number = (a * 1 + b * 3 + 2) | 0;
let v1: number = (a * 2 + b * 1 + 3) | 0;
let v2: any = a * 0.5;
let v3: Box = new Box(b + 3, null);
let v4: string = String((a + 4) & 31);
let v5: number = (a * 6 + b * 0 + 44) | 0;
let v6: Box = new Box(b + 6, null);
let v7: number = a * 7.5 + b / 4;
let v8: boolean = ((a + 8) & 1) === 0;
let v9: Box = new Box(b + 9, null);
let v10: string = String((a + 10) & 31);
let v11: any = String(b);
let v12: Box = new Box(b + 12, null);
let v13: string = String((a + 13) & 31);
let v14: number = (a * 15 + b * 6 + 12) | 0;
let v15: number = (a * 16 + b * 0 + 39) | 0;
let v16: number = (a * 17 + b * 2 + 32) | 0;
let v17: number = (a * 18 + b * 2 + 1) | 0;
let v18: number = a * 18.5 + b / 4;
let v19: number = (a * 20 + b * 3 + 28) | 0;
let v20: Box = new Box(b + 20, null);
let v21: number = a * 21.5 + b / 4;
let v22: number = (a * 23 + b * 3 + 30) | 0;
let v23: any = a * 0.5;
let v24: number = (a * 25 + b * 1 + 8) | 0;
let v25: number = (a * 26 + b * 7 + 33) | 0;
let v26: number = (a * 27 + b * 0 + 20) | 0;
let v27: Box = new Box(b + 27, null);
let v28: boolean = ((a + 28) & 1) === 0;
let v29: string = String((a + 29) & 31);
let v30: Box = new Box(b + 30, null);
let v31: number = (a * 32 + b * 3 + 34) | 0;
let v32: boolean = ((a + 32) & 1) === 0;
let v33: any = undefined;
let v34: string = String((a + 34) & 31);
let v35: Box = new Box(b + 35, null);
let v36: number = (a * 37 + b * 6 + 20) | 0;
let v37: number = (a * 38 + b * 7 + 13) | 0;
let v38: number = (a * 39 + b * 0 + 48) | 0;
let v39: any = a + 39;
v26 = (v36 >>> 3) & 1023;
if (v7 < v17) {
v34 = `${
v17 & 3}
${
v29.slice(0, 3)}
`;
L0: {
v20 = v35.next ?? v35;
 if (v14 > v1 && v1 > 19) break L0;
v19 = await opaqueLater(v31);
switch (v19 & 3) {
 case 0: v0 = (v0 - v38) | 0;
v37 = await opaqueLater(v36);
v25 = (v25 + (await v25)) | 0;
v19 = v7 < v38 ? fold(v2) : (v1 * 0.5 + v0) | 0;
 break;
 case 1: v14 = v1 > v36 && v36 > 14 ? (v24 >>> 3) & 1023 : opaqueInt(v17, v16);
try {
L1: {
v36 = (v22 % ((v26 & 15) + 1)) | 0;
 if (v17 < v22) break L1;
v18 = (v17 & 7) / (v24 & 1);
v9 = v20.next ?? v20;
}
let c2 = 4;
 L2: while (c2-- > 0) {
v20 = new Box(v15, null);
v8 = v32 || v18 < 0;
 if (v9.n > v24) continue;
}
}
 finally {
 switch (v5 & 3) {
 case 0: v19 = v37 ^ v37;
 break;
 case 1: v29 = String(v5 & 15);
 case 2: v38 = v10.length;
 break;
 default: v4 = v13.slice(1) + "q";
 }
 }
 case 2: if (typeof v2 === "undefined") {
let c3 = 1;
 do {
v2 = v2 ?? v35;
}
 while (--c3 > 0 && (v20.n > v5));
v35 = v20;
}
 else {
v9.n = opaqueInt(v0, v36);
for (const each of [v22, v16, 8]) {
v25 = (v19 + each) | 0;
v1 = Math.imul(v24, v14);
v33 = v2 ?? v12;
v23 = v24;
}
}
try {
L4: for (let c4 = 0;
 c4 < 3;
 c4++) {
v23 = typeof v11 === "number" ? v11 + 1 : v15;
v24 = v37 > v38 ? v37 : v38;
v12 = v28 ? v3 : spare;
v7 = opaqueDouble(v7, v5);
}
v38 = typeof v23 === "string" ? (v0 >>> 3) & 1023 : (v5 % ((v19 & 15) + 1)) | 0;
}
 finally {
v7 = v19 / ((v26 & 7) + 1);
}
v35 = new Box(v5, null);
 break;
 default: try {
for (const each of [v0, v19, 7]) {
v25 = (v24 + each) | 0;
v4 = (v10 + v10.length).slice(-4);
v37 = (v19 + v19) | 0;
v33 = undefined;
v35 = new Box(v25, null);
}
v31 = (v26 >>> 3) & 1023;
for (const each of [v19, v1, 0]) {
v31 = (v1 + each) | 0;
v8 = v16 === v24;
v10 = v32 ? v10 : "z";
v5 = v9.n | 0;
}
}
 finally {
 switch (v36 & 3) {
 case 0: v5 = v6.n | 0;
 break;
 case 1: v29 = v29.slice(1) + "q";
 case 2: v37 = (v18 * 3) | 0;
 break;
 default: v19 = (v37 + 38) | 0;
 }
 }
v19 = v27.n > v38 ? v15 > v19 ? v15 : v19 : (v17 + v26) | 0;
let c5 = 2;
 L5: while (c5-- > 0) {
v32 = v13 < "m";
let c6 = 4;
 L6: while (c6-- > 0) {
v17 = v34.length;
v3 = v8 ? v30 : spare;
v9.n = (v18 * 3) | 0;
 if (v29 < "k") continue;
}
 if (v16 < 0 || v36 < 0) continue;
}
 }
}
}
 else {
if (v17 < 0 || v37 < 0) {
let c7 = 3;
 do {
let c8 = 3;
 do {
let c9 = 2;
 L9: while (c9-- > 0) {
v8 = v25 === v1;
v2 = undefined;
 if (typeof v2 === "number") continue;
}
if (v30.n > v25) {
v20 = v8 ? v12 : spare;
v12.n = v28 ? v19 : v26;
v21 = v21 - v22 * 0.25;
}
 else {
v23 = v1;
v31 = fold(v11);
v28 = !v28;
}
try {
v31 = (v24 & v31) | 1;
v31 = (v31 + v16) | 0;
}
 finally {
 switch (v16 & 3) {
 case 0: v30 = v28 ? v27 : spare;
 break;
 case 1: v21 = v28 ? v7 : v31 + 0.5;
 case 2: v17 = v4.length;
 break;
 default: v29 = v32 ? v34 : "z";
 }
 }
}
 while (--c8 > 0 && (typeof v23 === "object"));
if (v22 < 0 || v1 < 0) {
for (const each of [v31, v36, 1]) {
v15 = (v14 + each) | 0;
v32 = !v8;
v4 = (v29 + v29.length).slice(-4);
v12.n = (v25 + v17) | 0;
}
}
 else {
v27 = new Box(v24, v3.next === null ? v3 : null);
}
try {
switch (v0 & 3) {
 case 0: v32 = v39 === undefined;
v34 = v10.slice(1) + "q";
v39 = v39 ?? v35;
 break;
 case 1: v6.n = v4.length;
v39 = v32 ? v15 : v4;
v23 = v27;
v10 = v29.slice(1) + "q";
 case 2: v25 = v37 ^ v26;
v37 = Math.imul(v26, v17);
v23 = typeof v2 === "number" ? v2 + 1 : v5;
 break;
 default: v35.n = (v16 + v26) | 0;
v29 = String(v14 & 15);
v36 = (v38 * 0.5 + v14) | 0;
v19 = (v25 >> (v5 & 7)) | 0;
 }
let c10 = 3;
 do {
v30 = v28 ? v35 : spare;
v35 = new Box(v36, null);
v13 = (v34 + "a").slice(-6);
}
 while (--c10 > 0 && (v12.n > v15));
v9 = v3.next ?? v3;
L11: {
v25 = (v22 % ((v0 & 15) + 1)) | 0;
v27 = v3;
v21 = Math.sqrt(Math.abs(v7));
 if (typeof v11 === "object") break L11;
v32 = v9.next === null;
v26 = (v25 + v26) | 0;
v27 = v27;
}
}
 finally {
 switch (v1 & 3) {
 case 0: v23 = undefined;
 break;
 case 1: v30.n = (v21 * 3) | 0;
 case 2: v37 = fold(v11);
 break;
 default: v35.n = v5 ^ v24;
 }
 }
v9 = v6.next ?? v6;
}
 while (--c7 > 0 && (v13 < "k"));
let c12 = 2;
 do {
if (v5 < v25) {
if (v19 < 0 || v17 < 0) {
v38 = (v38 * 0.5 + v19) | 0;
v1 = (v38 & v14) | 1;
v35 = new Box(v5, v9.next === null ? v9 : null);
v35.n = (v37 % ((v19 & 15) + 1)) | 0;
}
 else {
v10 = String(v16 & 15);
}
}
 else {
v36 = await opaqueLater(v14);
v24 = v34 < "k" ? (v31 - v1) | 0 : v3.n | 0;
switch (v31 & 3) {
 case 0: v28 = v27.next === null;
 break;
 case 1: v20.n = (v14 >>> 3) & 1023;
v13 = opaqueText(v4, v19);
 case 2: v31 = (v19 & v5) | 1;
v32 = v32 || v21 < 0;
 break;
 default: v22 = v6.n | 0;
v9 = new Box(v0, null);
 }
}
v26 = fold(v11);
switch (v31 & 3) {
 case 0: v35.n = (v19 >> (v22 & 7)) | 0;
v15 = (v16 + 31) | 0;
let c13 = 3;
 do {
v14 = (v26 >> (v15 & 7)) | 0;
v8 = v12.next === null;
v17 = (v14 - v15) | 0;
v5 = (v22 >>> 3) & 1023;
}
 while (--c13 > 0 && (v20.n > v16));
v1 = (v31 + (await v5)) | 0;
 break;
 case 1: v10 = v32 ? v34 : "z";
 case 2: try {
v30.n = (v18 * 3) | 0;
v26 = (v16 + v5) | 0;
}
 finally {
v27 = opaqueBox(v6, v22);
}
v15 = Math.imul(v31, v31);
 break;
 default: L14: for (let c14 = 0;
 c14 < 5;
 c14++) {
v10 = (v10 + v10.length).slice(-4);
v34 = (v13 + "a").slice(-6);
}
if (v20.n > v17) {
v12 = new Box(v31, null);
}
 else {
v8 = v34 < "m";
v28 = v11 === undefined;
v15 = (v38 >>> 3) & 1023;
v21 = Math.sqrt(Math.abs(v21));
}
try {
v35 = opaqueBox(v9, v15);
}
 finally {
v21 = (v0 & 7) / (v25 & 1);
}
 }
}
 while (--c12 > 0 && (v18 < v14));
v37 = (v37 + (await v26)) | 0;
try {
await null;
v28 = v39 === undefined;
}
 finally {
 switch (v0 & 3) {
 case 0: v31 = v31 ^ v0;
 break;
 case 1: v6.n = (v38 >>> 3) & 1023;
 case 2: v16 = (v19 & v5) | 1;
 break;
 default: v9 = v12.next ?? v12;
 }
 }
}
 else {
v38 = v18 < v5 ? v26 ^ v0 : (v18 * 3) | 0;
v4 = v32 ? v13 : "z";
try {
switch (v1 & 3) {
 case 0: if (v19 < v37) {
v12 = v12.next ?? v12;
}
 else {
v38 = (v25 - v26) | 0;
}
switch (v15 & 3) {
 case 0: v39 = v38;
v39 = null;
v25 = (v18 * 3) | 0;
 break;
 case 1: v3 = v32 ? v12 : spare;
v30.n = opaqueInt(v19, v25);
v6 = new Box(v16, v12.next === null ? v12 : null);
v31 = (v36 - v1) | 0;
 case 2: v8 = v10 < "m";
v16 = v0 > v22 ? v0 : v22;
v6 = v20;
v24 = opaqueInt(v15, v16);
 break;
 default: v16 = Math.imul(v26, v37);
v32 = v10 < "m";
v9 = v6.next ?? v6;
 }
v36 = (v21 * 3) | 0;
 break;
 case 1: L15: {
v8 = v10 < "m";
v30.n = Math.imul(v16, v17);
 if (typeof v39 === "object") break L15;
v35.n = (v0 + 63) | 0;
v11 = v13;
}
v16 = (v38 >> (v24 & 7)) | 0;
 case 2: v1 = v26 !== 36 ? (v26 + v36) | 0 : (v24 - v25) | 0;
try {
v38 = (v1 >>> 3) & 1023;
}
 finally {
 switch (v17 & 3) {
 case 0: v33 = typeof v11 === "number" ? v11 + 1 : v38;
 break;
 case 1: v35 = opaqueBox(v27, v14);
 case 2: v10 = (v34 + "a").slice(-6);
 break;
 default: v30 = v30;
 }
 }
await null;
 break;
 default: v5 = v27.n | 0;
v23 = v8 ? v15 : v34;
switch (v37 & 3) {
 case 0: v30.n = (v37 & v1) | 1;
 break;
 case 1: v27.n = v28 ? v37 : v22;
v20 = new Box(v15, v3.next === null ? v3 : null);
v5 = (v15 * 0.5 + v22) | 0;
v36 = (v1 >> (v25 & 7)) | 0;
 case 2: v13 = v32 ? v13 : "z";
v18 = v18 !== v18 ? v5 : v18;
 break;
 default: v9 = v32 ? v9 : spare;
v15 = v20.n | 0;
v33 = typeof v33 === "number" ? v33 + 1 : v37;
 }
 }
for (const each of [v5, v1, 8]) {
v5 = (v15 + each) | 0;
v37 = opaqueInt(v31, v17);
}
 if (v6.n > v15) throw v16;
if (v0 < 0 || v24 < 0) {
v31 = v5 < 0 || v14 < 0 ? (v38 >>> 3) & 1023 : v5 ^ v0;
v29 = String(v24 & 15);
if (v34 < "k") {
v16 = (v24 + 26) | 0;
v14 = (v7 * 3) | 0;
}
 else {
v33 = v21;
v7 = v7 * 0.5 + v1;
}
try {
v0 = fold(v33);
v0 = v9.n | 0;
}
 finally {
 switch (v24 & 3) {
 case 0: v2 = undefined;
 break;
 case 1: v33 = opaqueAny(v33);
 case 2: v13 = opaqueText(v34, v37);
 break;
 default: v18 = Math.floor(v21) + 0.25;
 }
 }
}
 else {
for (const each of [v1, v1, 3]) {
v1 = (v14 + each) | 0;
v17 = v9.n | 0;
v25 = fold(v33);
}
try {
v36 = (v0 + v15) | 0;
v35 = v8 ? v27 : spare;
}
 finally {
 switch (v38 & 3) {
 case 0: v30 = v8 ? v20 : spare;
 break;
 case 1: v0 = fold(v39);
 case 2: v24 = (v36 & v1) | 1;
 break;
 default: v12 = new Box(v17, null);
 }
 }
v35.n = fold(v33);
if (v26 <= v37) {
v10 = String(v15 & 15);
}
 else {
v2 = undefined;
v24 = (v38 + 84) | 0;
v30 = new Box(v5, v20.next === null ? v20 : null);
}
}
v29 = v28 ? v10 : "z";
}
 catch (thrown) {
v1 = ((thrown as number) | 0) + 1;
v24 = v28 ? v0 : v38;
}
 finally {
v11 = typeof v39 === "number" ? v39 + 1 : v22;
}
}
v22 = (v36 % ((v16 & 15) + 1)) | 0;
v38 = typeof v11 === "undefined" ? v4.length : (v22 * 0.5 + v22) | 0;
v26 = (v22 >>> 3) & 1023;
}
return (v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ v5 ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ v14 ^ v15 ^ v16 ^ v17 ^ fold(v18) ^ v19 ^ fold(v20) ^ fold(v21) ^ v22 ^ fold(v23) ^ v24 ^ v25 ^ v26 ^ fold(v27) ^ fold(v28) ^ fold(v29) ^ fold(v30) ^ v31 ^ fold(v32) ^ fold(v33) ^ fold(v34) ^ fold(v35) ^ v36 ^ v37 ^ v38 ^ fold(v39)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 100; i++) hash = (Math.imul(hash, 31) + (await f1(i, (i * 7) & 63))) | 0;
  console.log("f1 " + (hash >>> 0).toString(16));
}

function f2(a: number, b: number): number {
const spare = new Box(a, null);
let v0: number = (a * 1 + b * 3 + 25) | 0;
let v1: number = (a * 2 + b * 4 + 7) | 0;
let v2: number = a * 2.5 + b / 4;
let v3: number = (a * 4 + b * 7 + 16) | 0;
let v4: number = (a * 5 + b * 4 + 28) | 0;
let v5: number = (a * 6 + b * 8 + 31) | 0;
let v6: number = a * 6.5 + b / 4;
let v7: number = (a * 8 + b * 4 + 41) | 0;
let v8: number = (a * 9 + b * 4 + 42) | 0;
let v9: number = a * 9.5 + b / 4;
let v10: number = a * 10.5 + b / 4;
let v11: number = (a * 12 + b * 6 + 35) | 0;
let v12: number = (a * 13 + b * 7 + 42) | 0;
let v13: number = (a * 14 + b * 0 + 11) | 0;
let v14: number = (a * 15 + b * 3 + 42) | 0;
let v15: number = a * 15.5 + b / 4;
let v16: number = (a * 17 + b * 1 + 26) | 0;
let v17: number = a * 17.5 + b / 4;
let v18: number = a * 18.5 + b / 4;
let v19: number = (a * 20 + b * 4 + 22) | 0;
let v20: number = (a * 21 + b * 1 + 28) | 0;
let v21: number = (a * 22 + b * 1 + 6) | 0;
let v22: number = (a * 23 + b * 5 + 14) | 0;
let v23: number = a * 23.5 + b / 4;
let v24: number = a * 24.5 + b / 4;
let v25: number = (a * 26 + b * 0 + 29) | 0;
let v26: number = a * 26.5 + b / 4;
let v27: number = (a * 28 + b * 7 + 24) | 0;
let v28: number = (a * 29 + b * 4 + 16) | 0;
let v29: number = a * 29.5 + b / 4;
let v30: number = (a * 31 + b * 6 + 16) | 0;
let v31: number = a * 31.5 + b / 4;
let v32: number = (a * 33 + b * 7 + 14) | 0;
let v33: number = (a * 34 + b * 7 + 12) | 0;
let v34: number = a * 34.5 + b / 4;
let v35: number = a * 35.5 + b / 4;
let v36: number = a * 36.5 + b / 4;
let v37: number = a * 37.5 + b / 4;
let v38: number = a * 38.5 + b / 4;
let v39: number = a * 39.5 + b / 4;
const closure0 = (x: number): number => {
 v11 = (v11 + x) | 0;
 return v11 ^ v13;
 }
;
const closure1 = (x: number): number => {
 v25 = (v25 + x) | 0;
 return v25 ^ v32;
 }
;
try {
for (const each of [v12, v3, 6]) {
v8 = (v7 + each) | 0;
v24 = v25 / ((v3 & 7) + 1);
try {
v18 = (v12 > 0) ? v37 : v12 + 0.5;
}
 finally {
v38 = v13 & 1 ? NaN : v36;
}
v2 = opaqueDouble(v31, v8);
}
v39 = v37 * 0;
let c0 = 2;
 do {
v27 = v28 > v7 ? v28 : v7;
try {
v27 = Math.imul(v11, v22);
v10 = v19 & 1 ? NaN : v29;
if (v34 < v19) {
try {
v25 = (v22 + v20) | 0;
v8 = opaqueInt(v1, v28);
v36 = v29 * 0;
}
 finally {
 switch (v14 & 3) {
 case 0: v19 = (v11 * 0.5 + v20) | 0;
 break;
 case 1: v24 = (v8 & 7) / (v3 & 1);
 case 2: v19 = opaqueInt(v25, v22);
 break;
 default: v33 = (v7 - v33) | 0;
 }
 }
v30 = (v27 - v4) | 0;
}
 else {
v18 = (v30 & 7) / (v5 & 1);
try {
v28 = (v16 >> (v0 & 7)) | 0;
}
 finally {
 switch (v16 & 3) {
 case 0: v28 = opaqueInt(v27, v12);
 break;
 case 1: v28 = closure1(v4);
 case 2: v1 = closure0(v11);
 break;
 default: v35 = v16 & 1 ? NaN : v26;
 }
 }
}
v28 = v0 > v12 && v12 > 9 ? spare.n | 0 : (v0 * 0.5 + v11) | 0;
}
 finally {
 switch (v25 & 3) {
 case 0: v28 = (v11 >>> 3) & 1023;
 break;
 case 1: v25 = (v4 > 0) ? v4 : v7;
 case 2: v14 = (v17 * 3) | 0;
 break;
 default: v38 = v0 & 1 ? NaN : v24;
 }
 }
v21 = (v19 + v14) | 0;
}
 while (--c0 > 0 && (v1 < v13));
}
 finally {
v27 = (v15 * 3) | 0;
}
return (v0 ^ v1 ^ fold(v2) ^ v3 ^ v4 ^ v5 ^ fold(v6) ^ v7 ^ v8 ^ fold(v9) ^ fold(v10) ^ v11 ^ v12 ^ v13 ^ v14 ^ fold(v15) ^ v16 ^ fold(v17) ^ fold(v18) ^ v19 ^ v20 ^ v21 ^ v22 ^ fold(v23) ^ fold(v24) ^ v25 ^ fold(v26) ^ v27 ^ v28 ^ fold(v29) ^ v30 ^ fold(v31) ^ v32 ^ v33 ^ fold(v34) ^ fold(v35) ^ fold(v36) ^ fold(v37) ^ fold(v38) ^ fold(v39)) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 20; i++) hash = (Math.imul(hash, 31) + f2(i, (i * 7) & 63)) | 0;
  console.log("f2 " + (hash >>> 0).toString(16));
}
