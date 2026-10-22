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

function buildByAppending(count) {
  let text = "";
  for (let i = 0; i < count; i++) text += "ab";
  return text;
}

function buildByPrepending(count) {
  let text = "";
  for (let i = 0; i < count; i++) text = "ab" + text;
  return text;
}

function buildByDoubling(times) {
  let text = "ab";
  for (let i = 0; i < times; i++) text = text + text;
  return text;
}

function buildATree(depth) {
  return depth === 0 ? "x" : buildATree(depth - 1) + "-" + buildATree(depth - 1);
}

function probe(text) {
  return [text.length, text[0], text[text.length - 1], text.charCodeAt(text.length >> 1), text.indexOf("ba"), text.lastIndexOf("ab"), text.slice(-3), text.at(-1)];
}

function hash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

function lookUp(table, key) {
  return table[key];
}

for (let i = 0; i < 2000; i++) {
  probe("abab");
  hash("abab");
  lookUp({ abab: 1 }, "abab");
}

attempt("appended", () => probe(buildByAppending(100000)));
attempt("prepended", () => probe(buildByPrepending(100000)));
attempt("doubled", () => probe(buildByDoubling(20)));
attempt("a tree", () => probe(buildATree(12)));
attempt("hash of appended", () => hash(buildByAppending(50000)));
attempt("hash of prepended", () => hash(buildByPrepending(50000)));
attempt("hash of doubled", () => hash(buildByDoubling(16)));
attempt("all three are equal", () => [buildByAppending(1 << 10) === buildByPrepending(1 << 10), buildByAppending(1 << 10) === buildByDoubling(10), buildByDoubling(10) === "ab".repeat(1 << 10)]);
attempt("a rope that differs in the last character", () => [buildByAppending(1000) + "a" === buildByAppending(1000) + "b", buildByAppending(1000) + "a" < buildByAppending(1000) + "b"]);
attempt("a rope as a key", () => {
  const table = { abababab: "found" };
  return [lookUp(table, buildByAppending(4)), lookUp(table, buildByPrepending(4)), lookUp(table, buildByDoubling(2)), buildByAppending(4) in table, Object.hasOwn(table, buildByDoubling(2))];
});
attempt("a rope as a key that is stored", () => {
  const table = {};
  table[buildByAppending(3)] = 1;
  table[buildByPrepending(3)] = 2;
  table["ab" + make("'abab'")] = 3;
  return [Object.keys(table), table.ababab];
});
attempt("a rope as a map key", () => new Map([[buildByAppending(3), 1]]).get(buildByPrepending(3)));
attempt("a rope in a switch", () => {
  switch (buildByAppending(2)) {
    case "abab":
      return "matched";
  }
  return "not matched";
});
attempt("a rope that looks like an index", () => ["zero", "one", "two"]["" + make("'1'")] + ["a", "b"][make("'0'") + ""] + [..."0123456789ab"]["1" + make("'1'")]);
attempt("a rope of narrow and wide pieces", () => probe(buildByAppending(10) + "世" + buildByAppending(10)));
attempt("a rope of many kinds of pieces", () => {
  let text = "";
  for (let i = 0; i < 300; i++) text += i % 3 === 0 ? i : i % 3 === 1 ? "-" : [i];
  return [text.length, text.slice(0, 12), hash(text)];
});
attempt("a slice of a rope of slices", () => {
  const base = buildByAppending(1000);
  const text = base.slice(1, 500) + base.slice(3, 700) + base.slice(999);
  return [text.length, text.slice(495, 505), hash(text)];
});
attempt("a rope is split, joined, replaced and matched", () => {
  const text = buildByAppending(1000);
  return [text.split("b").length, text.split("").length, text.replaceAll("a", "").length, text.match(/ab/g).length, text.toUpperCase().slice(0, 4), text.trim().length, JSON.stringify(text).length, encodeURIComponent(text).length];
});
attempt("a rope is iterated", () => {
  let count = 0;
  for (const character of buildByAppending(5000)) if (character === "a") count++;
  return [count, [...buildByDoubling(8)].length];
});
attempt("a rope is turned into a number", () => [+("1" + make("'2'")), ("1" + make("'2'")) * 2, parseInt("1" + make("'2px'")), ("0x" + make("'1f'")) | 0]);
