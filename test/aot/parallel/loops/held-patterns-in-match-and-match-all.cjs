"use strict";

// Constants hold the patterns that match() and matchAll() are given in loops.
const lines = [];
for (let i = 0; i < 40; i++) lines.push(i % 5 === 3 ? "- item " + i : i % 3 ? "key" + i + ": value " + i * 7 : "## head " + i);
lines.push("kéy: vălue", "", ("key: " + lines[1]).slice(2), "key9: ".concat(lines[4], lines[7]));

const pair = /^(\w+): (.*)$/;
const named = /^(?<key>k\w+)(: (?<rest>v.*))?/;
const start = /key(\d)/y;
const word = /[a-z]+(\d*)/g;
const next = /(\w)\w*\s*/gy;
const anywhere = (() => {
  const digits = /(\d)(\d)?/;
  return line => {
    let sum = 0;
    for (let turn = 0; turn < 3; turn++) sum += (line.match(digits)?.[1] ?? 1) * 1 + (line.match(digits)?.index ?? 0);
    return sum;
  };
})();

function parts() {
  let lengths = 0;
  let text = "";
  for (const line of lines) {
    const match = line.match(pair);
    if (match) lengths += match[1].length * 100 + match[2].length + match.length + match.index;
    const [whole, key] = line.match(pair) ?? ["none"];
    text += whole.length + (key ?? "-");
    const groups = line.match(named)?.groups;
    if (groups) text += groups.key + (groups.rest === undefined ? "!" : groups.rest.length);
  }
  return lengths + " " + text;
}

function whole() {
  const found = [];
  for (const line of lines) {
    const match = line.match(pair);
    if (match) found.push(match);
  }
  return found.length + " " + JSON.stringify(found.slice(0, 2)) + found[1].input + found[1].index;
}

function steps() {
  let text = "";
  for (const line of lines) {
    start.lastIndex = line.length & 1;
    const match = line.match(start);
    text += match ? match[1] + start.lastIndex : start.lastIndex;
  }
  return text;
}

function all(pattern, change) {
  let text = "";
  let count = 0;
  for (const line of lines) {
    for (const match of line.matchAll(word)) {
      text += match[1] + match.index;
      change?.(count++);
    }
    for (const [found, letter] of line.matchAll(next)) count += found.length + letter.charCodeAt(0);
  }
  return count + " " + text;
}

function firstOfEach() {
  let text = "";
  for (const line of lines) {
    for (const match of line.matchAll(word)) {
      text += match[0] + word.lastIndex;
      break;
    }
  }
  return text;
}

console.log(parts());
console.log(whole());
console.log(steps());
console.log(all(), firstOfEach());
console.log(lines.map(anywhere).join(" "));

// matchAll() begins where the pattern says, and leaves it as it is.
word.lastIndex = 5;
next.lastIndex = 2;
console.log(all(), word.lastIndex, next.lastIndex);
word.lastIndex = "3";
console.log(all(undefined, count => (word.lastIndex = count % 3)), word.lastIndex);
word.lastIndex = { valueOf: () => 4 };
console.log(all(), typeof word.lastIndex);
word.lastIndex = -7.5;
next.lastIndex = 2 ** 40;
console.log(all(), word.lastIndex, next.lastIndex);
word.lastIndex = {
  valueOf() {
    throw new RangeError("lastIndex");
  },
};
try {
  all();
} catch (error) {
  console.log(error.message);
}
word.lastIndex = 0;
next.lastIndex = 0;
Object.freeze(word);
Object.freeze(pair);
console.log(all(), parts());

// What else the methods read.
pair.lastIndex;
Object.defineProperty(named, "exec", { value: line => (line.length % 2 ? null : { groups: { key: "own", rest: undefined } }), configurable: true });
console.log(parts());
delete named.exec;
named[Symbol.match] = line => ({ groups: { key: line, rest: "" } });
console.log(parts());
delete named[Symbol.match];
next[Symbol.matchAll] = line => [["", line]].filter(() => line);
console.log(all());
delete next[Symbol.matchAll];
Object.defineProperty(next, "flags", { value: "y" });
try {
  all();
} catch (error) {
  console.log(error.name);
}
start.lastIndex = 0;
Object.setPrototypeOf(start, { __proto__: RegExp.prototype, exec: line => [line, line.length] });
console.log(steps());
