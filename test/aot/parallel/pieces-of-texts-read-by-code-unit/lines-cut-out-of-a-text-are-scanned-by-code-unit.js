"use strict";
const hide = value => [value][JSON.parse("0")];
const page = JSON.parse(JSON.stringify("alpha = 1;\nbeta(gamma, 22);\n\nif (delta) { epsilon(); }\n// zeta eta theta\nx\nlast line without an end"));
function Scanner(input) {
  this.input = input;
  this.position = 0;
}
Scanner.prototype.word = function () {
  let sum = 0;
  for (;;) {
    const unit = this.input.charCodeAt(this.position);
    if (!(unit >= 97 && unit <= 122)) return sum;
    sum = (sum * 33 + unit) % 65521;
    this.position++;
  }
};
Scanner.prototype.all = function () {
  let sum = 7;
  while (this.position < this.input.length) {
    sum = (sum * 31 + this.word()) % 1000003;
    const unit = this.input.charCodeAt(this.position++);
    sum = (sum * 31 + (unit === unit ? unit : 3)) % 1000003;
  }
  return sum;
};
const out = [];
for (let round = 0; round < 14; round++) {
  for (const line of hide(page).split("\n")) out.push(new (hide(Scanner))(line).all());
}
const edges = [-1, 0, 1, 5, 9, 10, 11, 1000, 2147483647, -2147483648, 0.5, NaN, undefined, "2", 4294967296];
for (const line of hide(page).split("\n")) {
  for (const at of edges) out.push(String(hide(line).charCodeAt(at)), String(hide(line).codePointAt(at)));
}
let hash = 7;
for (const value of out) for (const unit of String(value)) hash = (hash * 31 + unit.charCodeAt(0)) % 1000003;
console.log(out.length, hash, out.slice(0, 7).join(), out.slice(-30).join());
