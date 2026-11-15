// `for (const x of list) s = s + area(x);` SIZE times in one function. `area` is a switch with a return in each case, and in a loop it is copied in place: each way out of the copy ends with a hint that
// lets its parameter go, and what the other ways read is laid later, so by position each hint's value is read behind it. Whether a hint lets its value go is asked of the ways on from it, and what it let go
// is looked for again in the steps on those ways. Each loop has a value of its own: both looks go no further than that value is read, not to the end of the function.
// It writes a program: SIZE says how many such loops a function holds, PASSES how many such functions there are.
// Sizes: 200 400 800
// Passes: 1
// Grows: the build, linear
// Room of the peak: 90 MB: each line of 41 bytes is a loop over a list with a switch copied into it, all in one unit: the peak rises in line with the size, by 125 KB a line: 125 | 151 | 200 MB
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const lines = [
  '"use strict";',
  "const list = [];",
  "for (let i = 0; i < 9; i++) list.push(i === 4 ? { kind: 'poly', at: [1, 2, 3] } : i % 2 ? { kind: 'circle', r: i % 7 } : { kind: 'rect', w: i % 5, h: 2 });",
  "function area(s) { switch (s.kind) { case 'circle': return s.r * s.r * 3; case 'rect': return s.w * s.h; case 'poly': return s.at.length; } }",
];
for (let copy = 0; copy < copies; copy++) {
  lines.push(`function inARow${copy}(t) {`);
  lines.push("  let s = t & 1;");
  for (let index = 0; index < size; index++) lines.push("  for (const x of list) s = s + area(x);");
  lines.push("  return s;");
  lines.push("}");
}
lines.push(`console.log(${Array.from({ length: copies }, (_, copy) => `inARow${copy}(${copy})`).join(", ")});`);
console.log(lines.join("\n"));
