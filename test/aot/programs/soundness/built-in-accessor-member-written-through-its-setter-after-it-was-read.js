const real = process.stdout;
const lines = [];
function width() { return process.stdout.columns === undefined ? "none" : typeof process.stdout.columns; }
function isReal() { return process.stdout === real; }
lines.push(isReal(), typeof process.stdout.write);
function replace(holder, value) { holder.stdout = value; }
function same(x) { return x; }
replace(same(same(process)), { write: 7, columns: "wide", fake: true });
lines.push(isReal(), typeof process.stdout.write, width(), process.stdout.fake);
console.error(lines.join(" "));
