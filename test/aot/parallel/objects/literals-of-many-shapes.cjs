// STATISTIC: VariantSets >= 1
"use strict";

// A scanner makes literals of six shapes. Names that all of them have are read where recursion and nested loops reach; objects of other shapes come too.
const log = [];
let hash = 7;
const show = value => (typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "{" + Object.keys(value).join() + "}" : String(value));
const out = value => {
  const text = show(value);
  for (let k = 0; k < text.length; k++) hash = (Math.imul(hash, 31) + text.charCodeAt(k)) | 0;
  if (log.length < 120) log.push(text);
};
const attempt = step => {
  try {
    out(step());
  } catch (error) {
    out(error.constructor.name);
  }
};
class Scanner {
  constructor(limit) {
    this.line = 1;
    this.index = 0;
    this.limit = limit;
  }
  name(start) {
    return { type: 3, value: "n" + start, line: this.line, start, end: this.index, escaped: false };
  }
  mark(start) {
    return { type: 7, value: start & 1 ? "(" : ")", line: this.line, start, end: this.index };
  }
  text(start) {
    return { type: 8, value: "t" + start, octal: false, line: this.line, start, end: this.index };
  }
  number(start) {
    return { type: 6, value: start / 2, line: this.line, start, end: this.index, raw: "" + start, big: null };
  }
  template(start) {
    return { type: 10, value: "`", cooked: null, head: true, tail: false, line: this.line, start, end: this.index };
  }
  pattern(start) {
    return { type: 9, value: "", pattern: "a", flags: "g", line: this.line, start, end: this.index };
  }
  lex() {
    const start = this.index++;
    if (start % 5 === 0) this.line++;
    switch ((start * 7) % 6) {
      case 0:
        return this.name(start);
      case 1:
        return this.mark(start);
      case 2:
        return this.text(start);
      case 3:
        return this.number(start);
      case 4:
        return this.template(start);
      default:
        return this.pattern(start);
    }
  }
}
class Parser {
  constructor(limit) {
    this.scanner = new Scanner(limit);
    this.ahead = this.scanner.lex();
    this.sameLine = 0;
    this.kept = [];
  }
  next() {
    const token = this.ahead;
    const next = this.scanner.lex();
    if (token.line === next.line) this.sameLine++;
    this.ahead = next;
    this.kept.push(token);
    if (this.kept.length > 7) this.kept.shift();
    return token;
  }
  match(value) {
    return this.ahead.type === 7 && this.ahead.value === value;
  }
  isName() {
    return this.ahead.type === 3;
  }
  sum() {
    let sum = 0;
    for (let k = 0; k < this.kept.length; k++) {
      for (let m = 0; m <= k; m++) sum += this.kept[k].end - this.kept[m].start + (this.kept[m].type === 8 ? 100 : 0);
    }
    return sum;
  }
  list(depth) {
    let count = 0;
    while (this.scanner.index < this.scanner.limit) {
      if (this.match(")")) {
        this.next();
        break;
      }
      const token = this.next();
      count += token.end - token.start;
      if (token.type === 7 && depth > 0) count += this.list(depth - 1);
      else if (this.isName()) count += 1000;
      if (token.type === 6) out(token.value);
      if (token.type === 9 && token.flags === "g") count += 3;
      if (count % 7 === 0) out(this.sum());
    }
    return count;
  }
}
for (let turn = 0; turn < 30; turn++) {
  const parser = new Parser(40 + turn);
  out(parser.list(4));
  out(parser.sameLine);
}

// Other things in place of a token, and tokens whose shape changes.
const others = [
  () => null,
  () => undefined,
  () => "text",
  () => 12,
  () => JSON.parse('{"type":7,"value":")","line":2,"start":1,"end":4}'),
  token => ({ ...token }),
  token => ({ ...token, extra: 1 }),
  token => Object.create(token),
  token => new Proxy(token, {}),
  token => new Proxy(token, { get: (target, key) => (key === "type" ? 7 : target[key]) }),
  token => Object.freeze(token),
  token => (delete token.type, token),
  token => (delete token.value, token),
  token => ((token.late = 1), token),
  token => ((token[0] = 5), token),
  token => Object.defineProperty(token, "type", { get: () => 7, configurable: true }),
  token => Object.defineProperty(token, "value", { value: ")", writable: false }),
  token => Object.setPrototypeOf(token, { type: 7, value: ")" }),
  token => (delete token.type, Object.setPrototypeOf(token, { type: 3 })),
  token => ((token.type = "7"), token),
  token => ((token.type = 7.5), token),
  token => ((token.value = { toString: () => ")" }), token),
  token => Object.assign(token, { type: 7, value: ")", line: -0 }),
  () => new (class { type = 7; value = ")"; line = 3; start = 0; end = 1; })(),
  () => [7, ")"],
  () => ({ get type() { return 7; }, value: ")", line: 1, start: 0, end: 1 }),
  () => ({ value: ")", type: 7, line: 1, start: 0, end: 1 }),
];
for (let round = 0; round < 3; round++) {
  for (const other of others) {
    const parser = new Parser(30);
    for (let k = 0; k < round * 2 + 1; k++) parser.next();
    parser.ahead = other(parser.ahead);
    attempt(() => parser.match(")"));
    attempt(() => parser.isName());
    attempt(() => parser.next().type);
    attempt(() => parser.sum());
    attempt(() => parser.list(2));
    attempt(() => Object.entries(parser.kept[round]).join());
  }
}
console.log(hash, log.length);
console.log(log.join(" "));
