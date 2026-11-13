// charCodeAt, codePointAt and charAt under positions that are doubles: NaN, infinities, fractions, -0, the ends of int32 and int64.
"use strict";
const out = [];
class State { init(input, pos) { this.input = input; this.pos = pos; } }
class Reader { constructor(input, pos) { this.state = new State(); this.state.init(input, pos); }
  codes(step) { let s = ""; for (let i = 0; i < 4; i++) { s += this.state.input.charCodeAt(this.state.pos) + ","; this.state.pos += step; } return s; }
  points(step) { let s = ""; for (let i = 0; i < 4; i++) { s += this.state.input.codePointAt(this.state.pos) + ","; this.state.pos += step; } return s; }
  chars(step) { let s = ""; for (let i = 0; i < 4; i++) { s += this.state.input.charAt(this.state.pos) + "," + this.state.input.at(this.state.pos); this.state.pos += step; } return s; } }
const inputs = ["", "a", "abcdef", "éሴ😀z", "x".repeat(70000)];
const positions = [0, -0, 0.5, -0.5, -0.999, -1, -1.5, 1, 2.999, 5, 6, NaN, Infinity, -Infinity, 1e300, -1e300, 2147483647, 2147483648, 4294967296, 4294967297, -2147483649, 9007199254740993, 9223372036854775807, 9223372036854775808, -9223372036854775808, 18446744073709551616, 69999, 69999.5, 70000, 5e-324];
const steps = [0, 1, 0.5, -1, NaN, 1e18];
for (let round = 0; round < 2; round++) for (const input of inputs) for (const pos of positions) for (const step of steps) out.push(new Reader(input, pos).codes(step) + new Reader(input, pos).points(step) + new Reader(input, pos).chars(step));
function sum(text, from, by) { let n = 0; for (let p = from; p < 8; p += by) { const c = text.charCodeAt(p); n = n * 3 + (c === c ? c : 7) | 0; } return n; }
for (const input of inputs) for (const from of positions) if (from >= -3) for (const by of [0.25, 1, 1.75]) out.push(sum(input, from, by));
let all = 0;
for (let i = 0; i < out.length; i++) { const line = String(out[i]); for (let j = 0; j < line.length; j++) all = (Math.imul(all, 31) + line.charCodeAt(j)) | 0; if (i % 40 === 39) { console.log(i, all, line.slice(0, 80)); all = 0; } }
console.log(all);
