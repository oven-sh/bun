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

function Token(kind, text) {
  this.kind = kind;
  this.text = text;
}

Token.prototype.firstCode = function () {
  return this.text.charCodeAt(0);
};

Token.prototype.size = function () {
  return this.text.length;
};

Token.prototype.isKeyword = function () {
  return this.kind === "keyword";
};

Token.prototype.label = function () {
  return this.kind + ":" + this.text;
};

Token.prototype.upper = function () {
  return this.text.toUpperCase();
};

function Comment(text) {
  Token.call(this, "comment", text);
}

Comment.prototype = Object.create(Token.prototype);
Comment.prototype.constructor = Comment;
Comment.prototype.body = function () {
  return this.text.slice(2).trim();
};

function describe(token) {
  const parts = [];
  for (const name of ["firstCode", "size", "isKeyword", "label", "upper", "body"]) {
    try {
      parts.push(name + " " + (typeof token[name] === "function" ? show(token[name]()) : "missing"));
    } catch (error) {
      parts.push(name + " threw " + error.constructor.name);
    }
  }
  return parts.join("; ");
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const token = new Token(i % 2 ? "keyword" : "name", "while");
  const comment = new Comment("// note");
  total += token.firstCode() + token.size() + token.label().length + token.upper().length + comment.body().length + comment.size();
  if (token.isKeyword()) total++;
}
console.log("2000 honest rounds", total);

const texts = [
  "'while'",
  "''",
  "new String('while')",
  "['w', 'h']",
  "{ length: 2, charCodeAt() { return 'look alike'; }, toUpperCase() { return 'LOOK'; }, slice() { return { trim() { return 'trimmed'; } }; }, toString() { return 'alike'; } }",
  "5",
  "null",
  "undefined",
  "Symbol('s')",
  "Buffer.from('// x')",
];

for (const text of texts) {
  console.log("new Token('name', " + text + "): " + describe(new Token("name", make(text))));
  console.log("new Token(" + text + ", 'x'): " + describe(new Token(make(text), "x")));
  console.log("new Comment(" + text + "): " + describe(new Comment(make(text))));
}

const changed = new Token("name", "while");
changed.text = 5;
console.log("the text is stored over by name: " + describe(changed));
changed[make("'te' + 'xt'")] = ["a", "b"];
console.log("the text is stored over by a computed name: " + describe(changed));
Object.assign(changed, { text: new String("assigned") });
console.log("the text is stored over by Object.assign: " + describe(changed));
delete changed.text;
console.log("the text is deleted: " + describe(changed));
Token.prototype.text = "inherited";
console.log("the text is inherited: " + describe(changed));
delete Token.prototype.text;
Object.defineProperty(changed, "text", { get: () => "from a getter" });
console.log("the text is a getter: " + describe(changed));

console.log("not made by the constructor: " + describe(Object.create(Token.prototype)));
console.log("made by Object.create with members: " + describe(Object.create(Comment.prototype, { text: { value: 7 }, kind: { value: new String("keyword") } })));
console.log("made from JSON: " + describe(Object.setPrototypeOf(JSON.parse('{ "text": ["j"], "kind": "keyword" }'), Token.prototype)));
console.log("a borrowed method: " + show(Token.prototype.label.call({ kind: 1, text: 2 })));
console.log("a borrowed method on a text: " + show(Token.prototype.size.call({ text: { length: -0 } })));
attempt("the constructor called without new", () => Token("name", "x"));
console.log("honest again: " + describe(new Token("keyword", "while")));

console.log("bytes made in plain sight", Buffer.from("he").length);
