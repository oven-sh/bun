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

const path = require("node:path");
const util = require("node:util");
const querystring = require("node:querystring");
const { StringDecoder } = require("node:string_decoder");

function baseName(value) {
  return path.posix.basename(value);
}

function directory(value) {
  return path.posix.dirname(value);
}

function extension(value) {
  return path.posix.extname(value);
}

function joined(value) {
  return path.posix.join("a", value, "b");
}

function normalized(value) {
  return path.posix.normalize(value);
}

function isAbsolute(value) {
  return path.posix.isAbsolute(value);
}

function formatted(value) {
  return util.format("%s|%d|%j", value, value, value);
}

function escaped(value) {
  return querystring.escape(value);
}

function parsedQuery(value) {
  return Object.keys(querystring.parse(value)).join(",");
}

function builtQuery(value) {
  return querystring.stringify({ key: value });
}

function bufferOf(value) {
  return Buffer.from(value, "utf8").toString("hex");
}

function withEncoding(value) {
  return Buffer.from("hi").toString(value);
}

function isEncoding(value) {
  return Buffer.isEncoding(value);
}

function written(value) {
  const bytes = Buffer.alloc(4);
  return [bytes.write(value), bytes.toString("hex")];
}

function filled(value) {
  return Buffer.alloc(4, value).toString("hex");
}

function decoded(value) {
  return new StringDecoder("utf8").write(value);
}

function strippedOfColors(value) {
  return util.stripVTControlCharacters(value);
}

const uses = [
  ["basename", baseName],
  ["dirname", directory],
  ["extname", extension],
  ["join", joined],
  ["normalize", normalized],
  ["isAbsolute", isAbsolute],
  ["format", formatted],
  ["escape", escaped],
  ["parse", parsedQuery],
  ["stringify", builtQuery],
  ["Buffer.from", bufferOf],
  ["toString(encoding)", withEncoding],
  ["isEncoding", isEncoding],
  ["write", written],
  ["alloc fill", filled],
  ["decoder", decoded],
  ["strip", strippedOfColors],
];

const values = [
  "'/x/y.z'",
  "''",
  "'hex'",
  "'a=1&b=2'",
  "'/x' + '/y.z'",
  "'/\\u4e16/\\ud83d\\ude00.\\u00e9'",
  "'\\ud83d'",
  "new String('/x/y.z')",
  "['/x/y.z']",
  "{ toString() { return '/x/y.z'; } }",
  "5",
  "-0",
  "5n",
  "true",
  "null",
  "undefined",
  "Symbol('/x')",
  "Buffer.from('/x/y.z')",
  "new Uint8Array([47, 120])",
  "{}",
];

let total = 0;
for (let i = 0; i < 1000; i++) {
  for (const [name, use] of uses) {
    if (name !== "toString(encoding)") total += String(use("/x/y.z")).length;
  }
}
console.log("1000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    let line;
    try {
      line = show(use(make(text)));
    } catch (error) {
      line = "threw " + error.constructor.name + " " + String(error.code);
    }
    console.log(name + " " + text + " -> " + line);
  }
}
