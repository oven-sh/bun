// STATISTIC: StepsKeptAsIntegers >= 3
// A field that one method compares is stepped by others: it stays an integer up to 2 ** 53, where a step changes nothing.
"use strict";
class Position {
  constructor(at) { this.at = at; this.line = 1; this.calls = 0; }
  past(end) { this.calls++; return this.at > end; }
  step() { this.at++; }
  back() { this.at--; }
  twice() { this.at++; this.at++; return this.at; }
  read(list) { return list[this.at++]; }
  pair(list) { return this.read(list) + "," + this.read(list); }
  newLine() { this.line++; return this.line > 3 ? "late" : "early"; }
}
class Lexer {
  constructor(text) { this.text = text; this.position = 0; this.start = 0; }
  peek() { return this.position < this.text.length ? this.text.charCodeAt(this.position) : -1; }
  skip() { while (this.peek() === 32) this.position++; }
  next() {
    this.skip(); this.start = this.position;
    let c = this.peek();
    if (c < 0) return null;
    if (c >= 97) { while ((c = this.peek()) >= 97) this.position++; } else this.position++;
    return this.text.slice(this.start, this.position);
  }
}
const show = value => Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
const list = ["a", "b", "c", "d", "e", "f"];
const starts = [0, 1, -1, 3, 2147483646, 2147483647, -2147483648, 4294967295, 9007199254740990, 9007199254740991, 9007199254740992, -9007199254740992, -9007199254740991];
for (const start of starts) {
  const p = new Position(start), seen = [];
  for (let k = 0; k < 4; k++) { p.step(); seen.push(show(p.at)); }
  seen.push(show(p.twice()), p.past(4), p.past(9007199254740991));
  for (let k = 0; k < 9; k++) { p.back(); if (k % 3 === 0) seen.push(show(p.at)); }
  seen.push(p.newLine(), p.newLine(), p.newLine(), p.calls, p.pair(list), show(p.at));
  console.log(seen.join(" "));
}
for (const text of ["", " ", "ab cd (e)  fgh(", "zz", "((  x"]) {
  const lexer = new Lexer(text), tokens = [];
  for (let token = lexer.next(); token !== null; token = lexer.next()) tokens.push(token + "@" + lexer.start + "-" + lexer.position);
  console.log(JSON.stringify(text), tokens.join(" "), lexer.position, 1 / lexer.start);
}
let sum = 0;
for (let k = 0; k < 3000; k++) { const p = new Position(k % 7); p.step(); p.twice(); if (p.past(5)) p.back(); sum += p.at * 2 + p.pair(list).length + p.calls; }
console.log(sum);
