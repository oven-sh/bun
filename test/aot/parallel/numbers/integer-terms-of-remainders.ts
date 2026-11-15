// A loop brings round a remainder whose dividend holds a term that no iteration changes: a small integer, a large one, one below zero, a fraction, NaN, a text, a term of the module.
const lines: string[] = [];
const show = (value: unknown): string => (Object.is(value, -0) ? "-0" : String(value));
const values: { level?: string } = { level: process.env.NOT_SET ?? "3" };
const factor = +values.level!;
let changing = 2;
function weighed(n: number, level: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 31 + i * level) % 1000003;
  return sum;
}
function read(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum * 33 + i * +values.level!) % 1000003;
  return sum;
}
function ofModule(n: number): number {
  let sum = 1;
  for (let i = 0; i < n; i++) sum = (sum * 7 + (i & 15) * factor) % 65537;
  return sum;
}
function changed(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum * 31 + i * changing) % 1000003;
    if (i === 20) changing = 0.5;
  }
  return sum;
}
function ofText(text: string, level: number): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i) * level - i) % 9007199254740991;
  return sum;
}
const levels = [0, 1, 3, 65535, 65536, 2147483647, 4294967296, 9007199254740991, 1e300, -1, -65535, 0.5, -0.5, -0, NaN, Infinity];
for (let turn = 0; turn < 3; turn++) for (const level of levels) lines.push(show(weighed(60, level)), show(weighed(0, level)), show(ofText("a text of some length", level)));
for (const level of ["4", " 5 ", "0x10", "1e3", "0.25", "-2", "", "x", "70000"]) {
  values.level = level;
  lines.push(show(read(70)), show(weighed(70, +level)));
}
values.level = undefined;
lines.push(show(read(5)));
for (let turn = 0; turn < 3; turn++) lines.push(show(ofModule(100)), show(changed(50)));
let sum = 0;
for (let i = 0; i < 500; i++) sum = (sum * 31 + i * factor) % 1000003;
console.log(lines.join() + " " + sum);
