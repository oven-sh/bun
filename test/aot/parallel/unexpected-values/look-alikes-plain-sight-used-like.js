// Look alikes in plain sight are used like strings.
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

class Rope {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }
  get length() {
    return this.left.length + this.right.length;
  }
  charCodeAt(index) {
    return index < this.left.length ? this.left.charCodeAt(index) : this.right.charCodeAt(index - this.left.length);
  }
  slice(from, to) {
    return this.toString().slice(from, to);
  }
  toUpperCase() {
    return new Rope(this.left.toUpperCase(), this.right.toUpperCase());
  }
  indexOf(piece) {
    return this.toString().indexOf(piece);
  }
  toString() {
    return this.left.toString() + this.right.toString();
  }
}

class Repeated {
  constructor(text, times) {
    this.text = text;
    this.length = text.length * times;
  }
  charCodeAt(index) {
    return index < this.length ? this.text.charCodeAt(index % this.text.length) : NaN;
  }
  slice() {
    return this;
  }
  toUpperCase() {
    return "REPEATED";
  }
  indexOf() {
    return -2;
  }
  [Symbol.toPrimitive](hint) {
    return hint === "number" ? this.length : this.text + "*";
  }
}

function OldStyle(text) {
  this.text = text;
  this.length = text.length;
}
OldStyle.prototype.charCodeAt = function (index) {
  return -this.text.charCodeAt(index);
};
OldStyle.prototype.slice = function (from, to) {
  return new OldStyle(this.text.slice(from, to));
};
OldStyle.prototype.toUpperCase = function () {
  return this.text.toUpperCase() + " (old style)";
};
OldStyle.prototype.indexOf = function (piece) {
  return String(this.text.indexOf(piece));
};
OldStyle.prototype.valueOf = function () {
  return "old " + this.text;
};

class Loud extends String {
  toUpperCase() {
    return super.toUpperCase() + "!";
  }
  charCodeAt(index) {
    return super.charCodeAt(index) + 1000;
  }
}

const literal = {
  length: 2,
  charCodeAt: index => 65 + index,
  slice: () => "literal slice",
  toUpperCase: () => "LITERAL",
  indexOf: () => 0,
  toString: () => "literal",
};

const listWithMethods = Object.assign(["l", "i", "s", "t"], { charCodeAt: index => index, toUpperCase: () => "LIST" });

function hash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

function head(text) {
  return text.slice(0, 2);
}

function shout(text) {
  return text.toUpperCase();
}

function find(text) {
  return text.indexOf("l");
}

function label(text) {
  return "<" + text + ">";
}

function template(text) {
  return `<${text}>`;
}

function isHello(text) {
  return [text === "hello", text == "hello", text < "i"];
}

function asKey(text) {
  return { hello: "by hello", "he*": "by he*", "old hello": "by valueOf", "[object Object]": "by object", literal: "by literal", "l,i,s,t": "by list" }[text];
}

function print(name, result) {
  console.log(name + " -> " + (result instanceof Rope ? "Rope " + result : result instanceof OldStyle ? "OldStyle " + result.text : result instanceof Repeated ? "Repeated " + result.text : show(result)));
}

function all(round) {
  print(round + " hash of a text", hash("hello"));
  print(round + " hash of a rope", hash(new Rope("he", "llo")));
  print(round + " hash of a rope of ropes", hash(new Rope(new Rope("h", "e"), new Rope("l", new Rope("l", "o")))));
  print(round + " hash of repeated", hash(new Repeated("he", 2)));
  print(round + " hash of old style", hash(new OldStyle("hello")));
  print(round + " hash of loud", hash(new Loud("hello")));
  print(round + " hash of a wrapped text", hash(new String("hello")));
  print(round + " hash of the literal", hash(literal));
  print(round + " hash of the list", hash(listWithMethods));

  print(round + " head of a text", head("hello"));
  print(round + " head of a rope", head(new Rope("he", "llo")));
  print(round + " head of repeated", head(new Repeated("he", 2)));
  print(round + " head of old style", head(new OldStyle("hello")));
  print(round + " head of loud", head(new Loud("hello")));
  print(round + " head of the literal", head(literal));
  print(round + " head of the list", head(listWithMethods));
  print(round + " head of a plain list", head(["h", "e", "l"]));

  print(round + " shout of a text", shout("hello"));
  print(round + " shout of a rope", shout(new Rope("he", "llo")));
  print(round + " shout of repeated", shout(new Repeated("he", 2)));
  print(round + " shout of old style", shout(new OldStyle("hello")));
  print(round + " shout of loud", shout(new Loud("hello")));
  print(round + " shout of the literal", shout(literal));
  print(round + " shout of the list", shout(listWithMethods));

  print(round + " find in a text", find("hello"));
  print(round + " find in a rope", find(new Rope("he", "llo")));
  print(round + " find in repeated", find(new Repeated("he", 2)));
  print(round + " find in old style", find(new OldStyle("hello")));
  print(round + " find in loud", find(new Loud("hello")));
  print(round + " find in the literal", find(literal));
  print(round + " find in the list", find(listWithMethods));

  for (const [name, value] of [["a text", "hello"], ["a rope", new Rope("he", "llo")], ["repeated", new Repeated("he", 2)], ["old style", new OldStyle("hello")], ["loud", new Loud("hello")], ["the literal", literal], ["the list", listWithMethods]]) {
    print(round + " label of " + name, label(value));
    print(round + " template of " + name, template(value));
    print(round + " comparisons of " + name, isHello(value));
    print(round + " key " + name, asKey(value));
  }
}

all("first");
let total = 0;
for (let i = 0; i < 2000; i++) total += hash("hello") + head("hello").length + shout("hello").length + find("hello") + label("hello").length + template("hello").length;
console.log("2000 honest rounds", total);
all("second");
