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

function hash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

function reversed(text) {
  let result = "";
  for (let i = text.length - 1; i >= 0; i--) result += text[i];
  return result;
}

function upper(text) {
  return text.toUpperCase();
}

function lower(text) {
  return text.toLowerCase();
}

function find(text, piece) {
  return [text.indexOf(piece), text.lastIndexOf(piece), text.includes(piece), text.startsWith(piece), text.endsWith(piece)];
}

function same(a, b) {
  return [a === b, a == b, a < b, a > b, Object.is(a, b)];
}

function countCharacters(text) {
  let count = 0;
  for (const character of text) count++;
  return count;
}

function lookUp(table, key) {
  return table[key];
}

function joined(a, b) {
  return a + "|" + b;
}

function isLetter(character) {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function escapeNonAscii(text) {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    result += code < 128 ? text[i] : "\\u" + code.toString(16).padStart(4, "0");
  }
  return result;
}

const narrow = ["hello", "world", "café", "ÿþ", "", "a"];
let total = 0;
const table = { hello: 1, "café": 2, "世界": 3, "😀": 4, "é": 5, "é": 6 };
for (let i = 0; i < 2000; i++) {
  const text = narrow[i % narrow.length];
  total += hash(text) + reversed(text).length + upper(text).length + lower(text).length + find(text, "l")[0] + countCharacters(text) + joined(text, text).length + escapeNonAscii(text).length;
  if (same(text, "hello")[0]) total++;
  if (lookUp(table, text)) total++;
  if (isLetter(text)) total++;
}
console.log("2000 narrow rounds", total);

const wide = [
  "'\\u4e16\\u754c'",
  "'hello \\u4e16\\u754c'",
  "'\\u0100'",
  "'\\u00ff'",
  "'\\ud83d\\ude00'",
  "'a\\ud83d\\ude00b'",
  "'\\u00df'",
  "'stra\\u00dfe'",
  "'\\u0130'",
  "'\\u0131'",
  "'\\u03a3\\u03a3'",
  "'\\u039f\\u0394\\u039f\\u03a3'",
  "'\\ufb01'",
  "'\\u01c5'",
  "'\\u00b5'",
  "'\\u212a'",
  "'\\u1e9e'",
  "'e\\u0301'",
  "'hello\\u4e16'.slice(0, 5)",
  "'caf\\u00e9\\u4e16'.slice(0, 4)",
  "'\\u4e16hello'.slice(1)",
];

for (const text of wide) {
  attempt("hash " + text, () => hash(make(text)));
  attempt("reversed " + text, () => reversed(make(text)));
  attempt("upper and lower " + text, () => [upper(make(text)), lower(make(text)), upper(make(text)).length, lower(make(text)).length]);
  attempt("characters " + text, () => [countCharacters(make(text)), make(text).length]);
  attempt("escaped " + text, () => escapeNonAscii(make(text)));
  attempt("look up " + text, () => lookUp(table, make(text)));
  attempt("is a letter " + text, () => isLetter(make(text)));
}

attempt("a wide piece in a narrow text", () => find("hello", "世"));
attempt("a narrow piece in a wide text", () => find("世hello界", "l"));
attempt("a wide piece in a wide text", () => find("世hello界", "界"));
attempt("a piece stored wide that holds narrow characters", () => find("hello", make("'l\\u4e16'.slice(0, 1)")));
attempt("a text stored wide equals the narrow one", () => same("hello", make("'hello\\u4e16'.slice(0, 5)")));
attempt("a text stored wide with a Latin-1 letter equals the narrow one", () => same("café", make("'caf\\u00e9\\u4e16'.slice(0, 4)")));
attempt("composed and decomposed differ", () => same("é", "é"));
attempt("order is by code unit", () => [same("￿", "𐀀"), same("z", "é"), same("é", "Ā"), same("Z", "a")]);
attempt("narrow and wide are joined", () => [joined("a", "世"), joined("世", "a"), joined("é", "Ā"), joined("\ud83d", "\ude00").length]);
attempt("halves of a pair are joined into one character", () => countCharacters("\ud83d" + make("'\\ude00'")));
attempt("narrow again", () => [hash("hello"), reversed("hello"), upper("café"), lower("CAFÉ"), find("hello", "l"), lookUp(table, "hello")]);
