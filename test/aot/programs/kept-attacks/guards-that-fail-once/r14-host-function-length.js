// Guards that fail once: host function length. It prints what plain Bun prints.
const fs = require("node:fs");
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 1000000);
const variant = process.argv[4] ?? "readFileSync";

let touched = 0;
if (trip) touched = fs.readFileSync.length + fs.existsSync.length + performance.now.length + Bun.nanoseconds.length + Buffer.byteLength.length;

function readsFile() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + fs.readFileSync("/dev/null").length) | 0;
  return sum;
}
function asksForFile() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (fs.existsSync("/") ? 1 : 0)) | 0;
  return sum;
}
function asksForTime() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (performance.now() > 0 ? 1 : 0)) | 0;
  return sum;
}
function asksForNanoseconds() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (Bun.nanoseconds() > 0 ? 1 : 0)) | 0;
  return sum;
}
function measuresText() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + Buffer.byteLength("abc")) | 0;
  return sum;
}
const loops = { readFileSync: readsFile, existsSync: asksForFile, now: asksForTime, nanoseconds: asksForNanoseconds, byteLength: measuresText };
console.log(variant, touched > 0, loops[variant]());
