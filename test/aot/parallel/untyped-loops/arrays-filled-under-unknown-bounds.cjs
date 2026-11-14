"use strict";
// STATISTIC: CapacitiesReservedFromSourceArrays >= 10
// New arrays are filled out of views, strings and arrays, under a count that only the iterations compare with, or that lies beside, above and below the source's length.
const unseen = JSON.parse('{"f":null}');
function chained(source, key, count) { var r = key, filled = []; for (var i = 0; i < count; i++) { var value = source[i]; filled[i] = value ^ (r >> 8); r = ((value + r) * 52845 + 22719) & 65535; } return filled.slice(4); }
function codes(text) { var filled = []; for (var i = 0, ii = text.length; i < ii; ++i) filled[i] = text.charCodeAt(i); return filled; }
function pushed(text) { const filled = []; for (let i = 0; i < text.length; i++) filled.push(text.charCodeAt(i)); return filled; }
function doubled(source, count) { var filled = []; for (var i = 0; i < count; i++) filled[i] = source[i] * 2; return filled; }
const bytes = new Uint8Array(300);
for (let i = 0; i < 300; i++) bytes[i] = i * 7;
const sources = [bytes, bytes.subarray(3, 90), new Uint8Array(0), new Float64Array([1.5, -0, NaN, 2 ** 31, 2 ** 53]), new Int32Array([1, -1, -(2 ** 31)]), new Uint32Array([2 ** 32 - 1, 5]), Array.from(bytes), [1.5, , "3"], [], { length: 2, 0: 5, 1: 6 }];
const texts = ["", "a", "abcdefghij".repeat(30), "中\u{1f600}x".repeat(9), ["ab", String(sources.length)].join("-").repeat(40)];
const say = list => list.length + ":" + list.slice(0, 40).map(value => Object.is(value, -0) ? "-0" : value).join();
let last = "";
for (let round = 0; round < 3; round++) {
  const answers = [];
  for (const source of sources) for (const count of [source.length, 0, -1, 7, 2.5, "6", NaN, 400]) {
    answers.push(say(chained(source, 55665, count)), say(doubled(source, count)));
    const grown = doubled(source, count); grown.push("end"); grown[grown.length + 1] = 0.5; answers.push(grown.length, grown.indexOf("end"), grown.length - 2 in grown);
  }
  for (const text of texts) answers.push(say(codes(text)), say(pushed(text)));
  last = answers.join("|");
}
let sum = 0;
for (let i = 0; i < last.length; i++) sum = (Math.imul(sum, 31) + last.charCodeAt(i)) | 0;
unseen.f = sum;
console.log(last.length, sum);
