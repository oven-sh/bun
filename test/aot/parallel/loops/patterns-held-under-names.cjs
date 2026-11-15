"use strict";

// Loops match by patterns that properties hold. Some hold another pattern on the way, or an object that only looks like one.
const lines = [];
for (let i = 0; i < 40; i++) lines.push(i % 5 === 3 ? "- item " + i : i % 3 ? "key" + i + ": value " + i * 7 : "## head " + i);
lines.push("kéy: vălue", "", ("key: " + lines[1]).slice(2), "key9: ".concat(lines[4], lines[7]));

class Patterns {
  static pair = /^(\w+): (.*)$/;
  static head = /^#+ (.*)/;
}

class Lexer {
  constructor(word) {
    this.word = word ?? /[a-z]+(\d+)?/;
    this.space = /\s+/g;
    this.next = /\w+/y;
  }
  words() {
    let found = "";
    for (const line of lines) {
      const match = this.word.exec(line);
      if (match) found += match.index + (match[1] ?? "-") + " ";
    }
    return found;
  }
  spaces() {
    let count = 0;
    for (const line of lines) {
      while (this.space.exec(line)) count += this.space.lastIndex;
    }
    return count;
  }
  steps() {
    let count = 0;
    for (const line of lines) {
      this.next.lastIndex = line.length >> 1;
      const match = this.next.exec(line);
      if (match) count += match[0].length * this.next.lastIndex;
    }
    return count;
  }
}

const rules = { item: /^- (item) (\d+)$/, digits: /\d+/, named: /(?<key>\w+):/ };

function pairs() {
  let lengths = 0;
  let heads = 0;
  for (const line of lines) {
    const match = Patterns.pair.exec(line);
    if (match) lengths += (match[1] ?? "absent").length * 100 + (match[2] ?? "").length;
    else if (Patterns.head.test(line)) heads++;
  }
  return lengths + " " + heads;
}

function items(change) {
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(rules.item);
    if (match) text += match[1] + match[2] + match.length + " ";
    text += lines[i].search(rules.digits);
    if (rules.named.test(lines[i])) text += rules.named.exec(lines[i]).groups?.key;
    if (i === 20) change?.();
  }
  return text;
}

console.log(pairs(), items());
const lexer = new Lexer();
console.log(lexer.words(), lexer.spaces(), lexer.steps());
console.log(new Lexer(/(\d)(\d)?/).words(), new Lexer({ exec: line => (line.length % 2 ? null : [line, line.length]) }).words());

const { pair, head } = Patterns;
Patterns.pair = /^(k)/;
console.log(pairs());
Patterns.pair = new RegExp(pair.source);
console.log(pairs());
Patterns.pair = /^(?:(key)|(-)|(#))(.)(.)/;
console.log(pairs());
Patterns.pair = pair;
Patterns.head = { test: line => line.length > 8 };
console.log(pairs());
Patterns.head = head;
head.lastIndex = { valueOf: () => (rules.read = (rules.read ?? 0) + 1) };
console.log(pairs(), rules.read);
head.lastIndex = 0;
pair.exec = line => (line.length % 2 ? null : ["", "own", line]);
console.log(pairs());
delete pair.exec;
Object.freeze(pair);
console.log(pairs());

console.log(items(() => (rules.item = /^(#+) (\w+) (\d+)/)));
console.log(items(() => (rules.item = new (class extends RegExp {})("^(key)(\\d+)"))));
console.log(items(() => ((rules.digits = /a/), (rules.named = /(?<key>h)e(a)/))));
lexer.space = /e/g;
lexer.next = /[a-z]/g;
console.log(lexer.spaces(), lexer.steps());
lexer.next = Object.defineProperty(/\w+/y, "lastIndex", { writable: false, value: 2 });
try {
  console.log(lexer.steps());
} catch (error) {
  console.log(error.name);
}
lexer.word = /(x)?(?:v)/;
console.log(lexer.words());
