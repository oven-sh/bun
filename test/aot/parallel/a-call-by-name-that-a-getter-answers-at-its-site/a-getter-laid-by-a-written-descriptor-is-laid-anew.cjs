"use strict";
const one = x => x + 1, two = x => x + 20, three = x => x + 300;
function drive(make, stretch) {
  const table = make(); let s = 0; const log = [];
  Object.defineProperty(table, "step", { configurable: true, get: () => one });
  for (let i = 0; i < 6 * stretch; i++) {
    if (i === stretch) Object.defineProperty(table, "step", { configurable: true, get: () => two });
    if (i === 2 * stretch) Object.defineProperty(table, "step", { configurable: true, writable: true, value: three });
    if (i === 3 * stretch) delete table.step;
    if (i === 4 * stretch) Object.defineProperty(table, "step", { configurable: true, get: () => one });
    if (i === 5 * stretch) Object.defineProperty(table, "step", { configurable: true, get: undefined });
    try { s = (s + table.step(i & 15)) | 0; } catch (error) { if (log.length < 2) log.push(i + " " + error.message); }
  }
  return s + " " + log.join(" | ");
}
class Kept { constructor() { this.seed = 1; } }
const stretch = +(process.argv[2] ?? 5000);
console.log(drive(() => Object.create({}), stretch));
console.log(drive(() => ({}), stretch));
console.log(drive(() => ({ seed: 1, other: 2 }), stretch));
console.log(drive(() => new Kept(), stretch));
console.log(drive(() => Object.create({ step: x => -x }), stretch));
