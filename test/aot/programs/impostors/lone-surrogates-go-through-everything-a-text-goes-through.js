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

const texts = [
  ["a high half", "\ud83d"],
  ["a low half", "\ude00"],
  ["a pair", "😀"],
  ["the halves swapped", "\ude00\ud83d"],
  ["a high half in the middle", "a\ud83db"],
  ["a high half at the end", "ab\ud83d"],
  ["a low half at the start", "\ude00ab"],
  ["two high halves and a low one", "\ud83d😀"],
  ["made by slicing a pair", make("'\\ud83d\\ude00'.slice(0, 1)")],
  ["made by indexing a pair", make("'\\ud83d\\ude00'[1]")],
  ["made from a code", String.fromCharCode(0xd83d)],
  ["made by JSON", JSON.parse('"\\ud83d"')],
];

function isWellFormed(text) {
  return text.isWellFormed();
}

function toWellFormed(text) {
  return text.toWellFormed();
}

function codePoints(text) {
  const seen = [];
  for (const character of text) seen.push(character.codePointAt(0).toString(16));
  return seen;
}

function codePointAtEach(text) {
  const seen = [];
  for (let i = 0; i < text.length; i++) seen.push(text.codePointAt(i).toString(16));
  return seen;
}

function encoded(text) {
  return encodeURIComponent(text);
}

function asJson(text) {
  return JSON.stringify(text);
}

function asJsonKey(text) {
  return JSON.stringify({ [text]: text });
}

function asBytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function asBuffer(text) {
  return Array.from(Buffer.from(text));
}

function byteLength(text) {
  return Buffer.byteLength(text);
}

function normalized(text) {
  return text.normalize("NFC") === text;
}

function cases(text) {
  return [text.toUpperCase() === text, text.toLowerCase() === text];
}

function matchedByDot(text) {
  return [text.match(/./g).length, text.match(/./gu).length, /^.$/u.test(text), /\ud83d/.test(text), /\ud83d/u.test(text), /\p{Cs}/u.test(text)];
}

function splitAndJoined(text) {
  return [text.split("").length, [...text].length, Array.from(text).length, text.split("").join("") === text, [...text].join("") === text];
}

function asAKey(text) {
  const table = {};
  table[text] = 1;
  const map = new Map([[text, 1]]);
  return [Object.keys(table)[0] === text, table[text], map.has(text), text in table, new Set([text, text + ""]).size];
}

function roundTrip(text) {
  return [JSON.parse(JSON.stringify(text)) === text, structuredClone(text) === text, new TextDecoder().decode(new TextEncoder().encode(text)) === text, Buffer.from(text, "utf16le").toString("utf16le") === text];
}

const uses = [
  ["is well formed", isWellFormed],
  ["to well formed", toWellFormed],
  ["code points", codePoints],
  ["code point at each", codePointAtEach],
  ["encodeURIComponent", encoded],
  ["JSON", asJson],
  ["JSON key", asJsonKey],
  ["TextEncoder", asBytes],
  ["Buffer.from", asBuffer],
  ["byte length", byteLength],
  ["normalized", normalized],
  ["cases", cases],
  ["matched", matchedByDot],
  ["split and joined", splitAndJoined],
  ["as a key", asAKey],
  ["round trip", roundTrip],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("hello")).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const [label, text] of texts) attempt(name + " of " + label, () => use(text));
}
