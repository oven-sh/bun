function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

class Scanner {
  constructor(source) {
    this.source = source;
    this.position = 0;
  }

  get done() {
    return this.position >= this.source.length;
  }

  peek() {
    return this.source[this.position];
  }

  next() {
    return this.source.charCodeAt(this.position++);
  }

  skipSpaces() {
    while (!this.done && this.source[this.position] === " ") this.position++;
  }

  word() {
    const start = this.position;
    while (!this.done && this.position < 40 && this.source[this.position] !== " ") this.position++;
    return this.source.slice(start, this.position);
  }

  words() {
    const found = [];
    for (let guard = 0; guard < 10 && !this.done; guard++) {
      this.skipSpaces();
      if (this.done) break;
      found.push(this.word());
    }
    return found;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const scanner = new Scanner("let x = 1");
  total += scanner.words().length + new Scanner("ab").next() + new Scanner("ab").peek().length;
}
console.log("2000 honest rounds", total);

const sources = [
  "'let x = 1'",
  "''",
  "'  '",
  "'l\\u00e9t \\u4e16 = \\ud83d\\ude00'",
  "'let' + ' ' + 'y'",
  "new String('let x = 1')",
  "['let', ' ', 'x', ' ', '=']",
  "[' ', ' ']",
  "Buffer.from('let x')",
  "new Uint8Array([32, 32, 1])",
  "{ length: 3, 0: 'a', 1: ' ', 2: 'b', slice(from, to) { return 'slice ' + from + ' ' + to; }, charCodeAt(i) { return 'code ' + i; } }",
  "{ length: 3 }",
  "{ get length() { return 2; }, get 0() { return ' '; }, get 1() { return 'z'; }, slice: Array.prototype.slice }",
  "12345",
  "null",
  "undefined",
  "(function () { return arguments; })('a', ' ', 'b')",
];

for (const text of sources) {
  attempt("words of " + text, () => new Scanner(make(text)).words());
  attempt("peek of " + text, () => new Scanner(make(text)).peek());
  attempt("next of " + text, () => new Scanner(make(text)).next());
  attempt("done of " + text, () => new Scanner(make(text)).done);
}

attempt("the source is replaced halfway", () => {
  const scanner = new Scanner("one two three");
  const first = scanner.word();
  scanner.source = ["o", "n", "e", " ", "list", " ", "now"];
  return [first, scanner.words()];
});
attempt("the source is replaced halfway by a computed name", () => {
  const scanner = new Scanner("one two three");
  const first = scanner.word();
  scanner[make("'source'")] = new String("one wrapped now");
  return [first, scanner.words()];
});
attempt("the position is a text", () => {
  const scanner = new Scanner("abc");
  scanner.position = "1";
  return [scanner.peek(), scanner.next(), scanner.position, scanner.peek(), scanner.done];
});
attempt("the position is a fraction", () => {
  const scanner = new Scanner("abc");
  scanner.position = 0.5;
  return [scanner.peek(), scanner.next(), scanner.position, scanner.word()];
});
attempt("the position is negative", () => {
  const scanner = new Scanner("abc");
  scanner.position = -1;
  return [scanner.peek(), scanner.next(), scanner.position, scanner.peek()];
});
attempt("a subclass overrides peek and done", () => {
  class Odd extends Scanner {
    get done() {
      return this.position >= 2;
    }
  }
  return new Odd("abcdef ghi").words();
});
attempt("methods borrowed for a plain object", () => Scanner.prototype.word.call({ source: "ab cd", position: 0, done: false }));
attempt("honest again", () => new Scanner("let x = 1").words());

console.log("bytes made in plain sight", Buffer.from("he").length);
