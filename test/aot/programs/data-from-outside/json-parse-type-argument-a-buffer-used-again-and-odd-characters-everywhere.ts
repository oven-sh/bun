// Doubts from reading, each as a run against plain JSON.parse: the buffer used again for a shorter text; a NUL, 0xFF and U+0100 at every place; a parse entered from inside a parse.
type Point = { x: number; y: number; label?: string };
type Lists = Record<string, number[]> | Record<string, string[]>;
const plainly: (text: string) => any = JSON.parse;
function say(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error: any) {
    return error.name === "TypeError" ? "TypeError" : error.name;
  }
}
let different = 0;
let compared = 0;
function check(text: string, isRefusalFine = false): void {
  compared++;
  const [typed, plain] = [say(() => JSON.parse<Point>(text)), say(() => plainly(text))];
  if (typed !== plain && !(isRefusalFine && typed === "TypeError" && plain !== "SyntaxError") && different++ < 5) console.log("DIFFERS " + JSON.stringify(text).slice(0, 120) + " | " + typed.slice(0, 60) + " | " + plain.slice(0, 60));
}
const whole = '{"x":1,"y":2,"label":"l","other":[1,{"a":"b"}],"last":"z"}';
for (const size of [900, 1000, 5000, 70000]) {
  check(`{"x":1,"y":2,"pad":"${"p".repeat(size)}","tail":${whole}}`);
  for (let cut = 1; cut <= whole.length; cut++) check(whole.slice(0, cut), true);
}
for (const unit of ["\0", "\x01", "\x1f", "\x7f", "\xff", "Ā", "\ud800", "﻿", " "]) {
  for (let at = 0; at <= whole.length; at++) {
    check(whole.slice(0, at) + unit + whole.slice(at), true);
    check(whole.slice(0, at) + unit + whole.slice(at + 1), true);
  }
}
console.log(compared + " texts, " + different + " differ");
let entered = 0;
const keys = Object.keys;
try {
  (Object as any).keys = function (value: object): string[] {
    entered++;
    if (entered < 4) JSON.parse<Point>('{"y":2,"o":1,"x":1}'), JSON.stringify(JSON.parse<Point>('{"o":[1],"x":1,"y":2}'));
    return keys(value);
  };
} catch (error: any) {
  console.log("Object.keys cannot be replaced: " + error.name);
}
console.log(say(() => JSON.parse<{ a: number; lists: Lists; z: number }>('{"o":1,"a":1,"lists":{"k":["s"],"m":[]},"p":2,"z":3}')), entered > 0 ? "entered" : "not entered");
function addToObjectPrototype(): void {
  (Object.prototype as any).y = 5;
}
function removeFromObjectPrototype(): void {
  delete (Object.prototype as any).y;
}
try {
  (Object as any).keys = keys;
  addToObjectPrototype();
  console.log(say(() => JSON.parse<Point>('{"x":1}')), say(() => JSON.parse<Point>('{"\\u0078":1}')), say(() => JSON.parse<Point>('{"x":1,"o":2}')));
  removeFromObjectPrototype();
} catch (error: any) {
  console.log("Object.prototype cannot be changed: " + error.name);
}
