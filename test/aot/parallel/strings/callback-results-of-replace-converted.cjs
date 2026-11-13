// STATISTIC: CallbackResultsConverted >= 1
"use strict";

// replace() converts what its callback returns to a string. The objects that a callback may return are handed to no other code.
const log = [];
const out = value => log.push(typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value));
const attempt = step => {
  try {
    out(step());
  } catch (error) {
    out(error instanceof TypeError ? "TypeError" : error.message);
  }
};
function token(type, value) {
  return { type, value, line: type + 1 };
}
function message(format, ...parts) {
  return format.replace(/%(\d)/g, (whole, place) => parts[place]);
}
function messageOfWord(format, parts) {
  return format.replace("%0", () => parts[0]);
}
function total(list) {
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) {
    for (let k = 0; k < list.length; k++) {
      sum = (sum + list[k].type * 3 + list[k].line) | 0;
      list[k].line = (list[k].line + turn) & 15;
    }
  }
  return sum;
}
const tokens = [];
for (let k = 0; k < 9; k++) tokens.push(token(k, "v" + k));
out(total(tokens));
attempt(() => message("a %0 b %1 c", tokens[1], "text"));
attempt(() => message("%0%1%9", 1, null));
attempt(() => messageOfWord("is %0.", [tokens[2]]));
out(total(tokens));

// Conversions that run code, change what they convert, throw, or return no primitive.
class Word {
  constructor(text) {
    this.text = text;
    this.asked = 0;
  }
  toString() {
    this.asked++;
    this.text += "!";
    return this.text;
  }
}
const word = new Word("w");
attempt(() => message("%0 %0", word));
out(word.asked + word.text);
class Tagged {
  constructor(n) {
    this.n = n;
  }
  [Symbol.toPrimitive](hint) {
    this.n += 1;
    return hint + this.n;
  }
  get [Symbol.toStringTag]() {
    return "never";
  }
}
const tagged = new Tagged(1);
attempt(() => message("<%0>", tagged));
out(tagged.n);
class Tag {
  get [Symbol.toStringTag]() {
    tokens[0].type = 70;
    return "Tag";
  }
}
attempt(() => message("%0", new Tag()));
out(total(tokens));
attempt(() => message("%0", { toString: () => ({}), valueOf: () => 5 }));
attempt(() => message("%0", { toString: () => ({}), valueOf: () => ({}) }));
attempt(() => message("%0", { toString() { throw new Error("thrown"); } }));
attempt(() => message("%0", { toString: null, valueOf() { tokens[3].type = "three"; return 1n; } }));
out(typeof tokens[3].type);
attempt(() => message("%0", Symbol("s")));
attempt(() => message("%0", Object.create(null)));
attempt(() => message("%0%1", [tokens[4], [1, [2]]], () => 1));
attempt(() => message("%0", new Proxy(tokens[5], { get: (target, key) => (key === "toString" ? () => "trap" : target[key]) })));
attempt(() => "x-y".replaceAll("-", () => tokens[6]));
attempt(() => "x1y2".replaceAll(/\d/g, digit => ({ toString: () => "[" + digit + "]" })));
attempt(() => /b/[Symbol.replace]("abc", () => tokens[7]));
attempt(() => "abc".replace({ [Symbol.replace]: (text, by) => text + by().type }, () => tokens[8]));
let escaped;
tokens[1].toString = function () {
  escaped = this;
  return "own";
};
attempt(() => message("%0", tokens[1]));
escaped.type = -0;
escaped.line = 0.5;
out(tokens[1].type);
out(tokens[1].line);
attempt(() => message("%0 %1", tokens[2], {}));
attempt(() => total(tokens.slice(2, 4)));
delete tokens[2].type;
attempt(() => total([tokens[2]]));
console.log(log.join("\n"));
