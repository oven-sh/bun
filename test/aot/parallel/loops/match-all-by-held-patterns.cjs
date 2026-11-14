"use strict";

// Constants hold the patterns that loops step through with matchAll(), which begins where each pattern says.
const lines = [];
for (let i = 0; i < 40; i++) lines.push(i % 5 === 3 ? "- item " + i : i % 3 ? "key" + i + ": value " + i * 7 : "## head " + i);
lines.push("kéy: vălue", "", ("key: " + lines[1]).slice(2), "key9: ".concat(lines[4], lines[7]));

const word = /[a-z]+(\d*)/g;
const next = /(\w)\w*\s*/gy;
const pair = /^(\w+): (.*)$/;

function steps(change) {
  let text = "";
  for (const line of lines) {
    for (const match of line.matchAll(word)) {
      text += match[1] + match.index;
      if (change) word.lastIndex = change(match.index);
    }
  }
  return text;
}

function sticky() {
  let count = 0;
  for (const line of lines) {
    for (const [found, letter] of line.matchAll(next)) count += found.length * letter.charCodeAt(0);
  }
  return count;
}

function first() {
  let text = "";
  for (const line of lines) {
    for (const match of line.matchAll(word)) {
      text += match[0] + word.lastIndex;
      break;
    }
  }
  return text;
}

function lists() {
  const found = [];
  for (const line of lines) {
    for (const match of line.matchAll(word)) found.push(match);
  }
  return found.length + JSON.stringify(found.slice(0, 3)) + found[4].input + found[4].index;
}

function pairs() {
  let sum = 0;
  for (const line of lines) {
    const match = line.match(pair);
    if (match) sum += match[1].length * 10 + match[2].length + match.index + match.length;
  }
  return sum;
}

console.log(steps(), sticky(), first(), lists(), pairs());
word.lastIndex = 5;
next.lastIndex = 2;
console.log(steps(), sticky(), first(), word.lastIndex, next.lastIndex);
console.log(steps(index => index % 4), word.lastIndex);
word.lastIndex = "3";
console.log(steps(), typeof word.lastIndex);
let reads = 0;
word.lastIndex = { valueOf: () => (reads++, 4) };
console.log(steps(), reads);
word.lastIndex = -7.5;
next.lastIndex = 2 ** 40;
console.log(steps(), sticky(), word.lastIndex, next.lastIndex);
next.lastIndex = NaN;
pair.lastIndex = { valueOf: () => (reads++, 1) };
console.log(sticky(), pairs(), reads);
word.lastIndex = {
  valueOf() {
    throw new RangeError("lastIndex");
  },
};
try {
  steps();
} catch (error) {
  console.log(error.message);
}
