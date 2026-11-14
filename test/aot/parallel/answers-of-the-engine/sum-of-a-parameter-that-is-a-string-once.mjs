// If Link held a sum for a number because numbers had arrived at its operands first, the text that comes later would be read as a number by code that was compiled for numbers: out of a parameter, out of an element of a list and out of a field.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldSum(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldDifference(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldTotal(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldField(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldCapture(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function add(a, b) { toldSum(a + b); }
function less(a, b) { toldDifference(a - b); }
function total(list, n) { let sum = 0; for (let i = 0; i < n; i = i + 1) { sum = sum + list[i]; } toldTotal(sum); }
class Cell { constructor(value) { this.value = value; } grow(by) { this.value = this.value + by; } tell() { toldField(this.value); } }
function keeper(start) { let kept = start; return { grow(by) { kept = kept + by; }, tell() { toldCapture(kept); } }; }
const cell = new Cell(1);
const kept = keeper(1);
add(1, 2);
add(1.5, 2);
less(7, 2);
total([1, 2, 3], 3);
cell.grow(1);
cell.tell();
kept.grow(1);
kept.tell();
add("1", 2);
add(1, "2");
less("7", 2);
less("x", 2);
total([1, "2", 3], 3);
cell.grow("!");
cell.tell();
cell.grow(1);
cell.tell();
kept.grow("?");
kept.tell();
add(1, 2);
report("end");
