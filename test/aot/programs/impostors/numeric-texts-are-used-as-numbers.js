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

function plus(text) {
  return +text;
}

function minusZero(text) {
  return text - 0;
}

function timesOne(text) {
  return text * 1;
}

function orZero(text) {
  return text | 0;
}

function shifted(text) {
  return text >>> 0;
}

function notNot(text) {
  return ~~text;
}

function plusOne(text) {
  return text + 1;
}

function onePlus(text) {
  return 1 + text;
}

function incremented(text) {
  text++;
  return text;
}

function addedTo(text) {
  let total = 10;
  total += text;
  return total;
}

function subtractedFrom(text) {
  let total = 10;
  total -= text;
  return total;
}

function negated(text) {
  return -text;
}

function byNumber(text) {
  return Number(text);
}

function isNotANumber(text) {
  return [isNaN(text), Number.isNaN(text), isFinite(text), Number.isFinite(text), Number.isInteger(text)];
}

function rounded(text) {
  return [Math.floor(text), Math.round(text), Math.max(text, 0), Math.abs(text)];
}

function equalsTen(text) {
  return [text == 10, text === 10, text < 11, text >= 10, text != 10];
}

function asIndex(text) {
  return ["zero", "one", "two"][text];
}

function modulo(text) {
  return text % 3;
}

const uses = [
  ["+x", plus],
  ["x - 0", minusZero],
  ["x * 1", timesOne],
  ["x | 0", orZero],
  ["x >>> 0", shifted],
  ["~~x", notNot],
  ["x + 1", plusOne],
  ["1 + x", onePlus],
  ["x++", incremented],
  ["+= x", addedTo],
  ["-= x", subtractedFrom],
  ["-x", negated],
  ["Number", byNumber],
  ["isNaN", isNotANumber],
  ["Math", rounded],
  ["against 10", equalsTen],
  ["as an index", asIndex],
  ["x % 3", modulo],
];

const texts = ["10", "'10'", "'1'", "'0'", "'-0'", "'+1'", "' 10 '", "'\\n10\\t'", "'10.0'", "'1e1'", "'0x0a'", "'0b1010'", "'0o12'", "'010'", "'1_0'", "'10n'", "'10px'", "''", "' '", "'.5'", "'5.'", "'.'", "'-'", "'Infinity'", "'-Infinity'", "'infinity'", "'NaN'", "'1,000'", "'\\u0661'", "'\\uff11'", "'4294967296'", "'2147483648'", "'-2147483649'", "'1e400'", "'9007199254740993'", "'0.1'", "'--1'", "'1 2'", "'null'", "'true'", "new String('10')", "['10']", "[[['10']]]"];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(10)).length;
}
console.log("2000 honest rounds with the number", total);

function outcome(use, text) {
  try {
    return show(use(make(text)));
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

for (const text of texts) {
  for (let from = 0; from < uses.length; from += 6) {
    console.log(text + " -> " + uses.slice(from, from + 6).map(([name, use]) => name + " " + outcome(use, text)).join("; "));
  }
}
