"use strict";
const key = JSON.parse('"find"');
const getterOf = by => ({ get: () => x => x + by, configurable: true });
function drive(stretch) {
  const top = Object.defineProperty(JSON.parse("{}"), key, getterOf(1)), other = Object.defineProperty(JSON.parse("{}"), key, getterOf(50000));
  const middle = Object.create(top), bottom = Object.create(middle), beside = Object.create(middle);
  let s = 0, r = 0; const marks = [];
  for (let i = 0; i < 10 * stretch; i++) {
    if (i === stretch) Object.defineProperty(middle, key, { value: x => x + 100, configurable: true, writable: true });
    if (i === 2 * stretch) delete middle.find;
    if (i === 3 * stretch) Object.defineProperty(middle, key, getterOf(2000));
    if (i === 4 * stretch) delete middle.find;
    if (i === 5 * stretch) Object.setPrototypeOf(middle, other);
    if (i === 6 * stretch) Object.setPrototypeOf(bottom, top);
    if (i === 7 * stretch) Object.defineProperty(top, key, getterOf(7));
    if (i === 8 * stretch) Object.defineProperty(bottom, key, getterOf(900000));
    if (i === 9 * stretch) { delete bottom.find; Object.setPrototypeOf(bottom, null); }
    try { r = (r + beside.find(i & 7)) | 0; s = (s + bottom.find(i & 7)) | 0; } catch (error) { s = (s + 1) | 0; }
    if (i % stretch === stretch - 1) marks.push(s + "/" + r);
  }
  return marks.join(" ");
}
console.log(drive(+(process.argv[2] ?? 5000)));
