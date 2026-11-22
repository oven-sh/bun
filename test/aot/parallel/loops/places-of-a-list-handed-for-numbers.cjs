// A large loop hands elements of one list to functions that compute numbers, eight and more of them in each turn, and gets a version.
// STATISTIC: LargeLoopsOfElementsVersioned >= 1
"use strict";
function bend(far, near, word, by) {
  return (((far << 3) ^ (near >>> by)) + word) | 0;
}
function fold(far, near, word, by) {
  const sum = (far & near) + word + by;
  return (sum ^ (sum << 7)) | 0;
}
function lift(far, word) {
  return Math.imul(far ^ word, 0x101) + (word >> 2);
}
function digest(words, count) {
  let red = 3;
  let green = -7;
  let blue = 11;
  for (let at = 0; at < count; at += 12) {
    const before = red;
    red = bend(red, green, words[at], 3);
    green = bend(green, blue, words[at + 1], 5);
    blue = bend(blue, red, words[at + 2], 7);
    red = fold(red, blue, words[at + 3], 1);
    green = fold(green, red, words[at + 4], 2);
    blue = fold(blue, green, words[at + 5], 3);
    red = lift(red, words[at + 6]) | 0;
    green = lift(green, words[at + 7]) | 0;
    blue = lift(blue, words[at + 8]) | 0;
    red = bend(red, blue, words[at + 9], 11);
    green = fold(green, blue, words[at + 10], 13);
    blue = bend(blue, green, words[at + 11], 2);
    red = fold(red, green, words[at + 1], 4);
    green = bend(green, red, words[at + 5], 9);
    blue = lift(blue, words[at]) | 0;
    blue = (blue + before) | 0;
  }
  return red + ":" + green + ":" + blue;
}
function wordsOf(count, by) {
  const words = [];
  for (let at = 0; at < count; at++) words.push(Math.imul(at + 1, by) | 0);
  return words;
}
for (let round = 0; round < 30; round++) {
  const answer = digest(wordsOf(48, 0x1234567 + round * 2), 48);
  if (round % 8 === 0) console.log(round, answer);
}
console.log(digest([], 12), digest(wordsOf(5, 3), 24), digest(wordsOf(30, 77), 30), digest(wordsOf(12, 5), 0));
console.log(digest(wordsOf(24, 9).map(word => word + 0.75), 24), digest(wordsOf(24, 9).map(word => word * 4096), 24));
console.log(digest(Int32Array.from(wordsOf(24, 9)), 24), digest(Uint8Array.from(wordsOf(24, 9)), 24), digest(Float32Array.from(wordsOf(24, 9)), 24));
console.log(digest(wordsOf(24, 9).map(String), 24), digest("123456789012345678901234", 24), digest([1, , 3, null, undefined, true, "7", {}, [9], NaN, Infinity, -0], 12));
const gap = wordsOf(24, 9);
delete gap[13];
console.log(digest(gap, 24));
const late = wordsOf(36, 9);
Object.defineProperty(late, 14, { get() { late.length = 20; return 5; } });
console.log(digest(late, 36), late.length);
try {
  digest([1n, 2n], 12);
} catch (error) {
  console.log(error.constructor.name);
}
