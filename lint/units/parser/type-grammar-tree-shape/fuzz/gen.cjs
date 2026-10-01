// node gen.cjs <seed> <count> > forms.txt : random type-like texts, one per line ("\n" inside a text as \n)
let seed = Number(process.argv[2] || 1) >>> 0;
const count = Number(process.argv[3] || 1000);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const names = ["A", "B", "C", "a", "b", "x", "T", "U", "K"];
const kws = ["any", "unknown", "never", "void", "null", "undefined", "number", "string", "boolean", "bigint", "symbol", "object", "this"];
const odd = ["keyof", "readonly", "unique", "infer", "asserts", "abstract", "is", "symbol", "new", "typeof", "import", "const", "function", "if", "class", "in", "extends", "out", "static", "public", "async", "as", "of", "get", "set", "type", "yield", "await", "default", "export", "true", "false", "delete", "super", "instanceof"];
const punct = ["|", "&", "[", "]", "(", ")", "{", "}", "<", ">", ",", ":", "?", "!", ".", "...", "=>", "=", "-", ";", "*", "+", "extends", "is", "\n", ">>", "<<", "?.", "@", "#p", "`a`", "`a${", "}b`", "1", "1n", "\"s\"", "''"];
function type(d) {
  if (d <= 0) return pick([...names, ...kws, "1", "\"s\"", "true"]);
  const r = rnd();
  if (r < 0.16) return pick(names) + (chance(0.3) ? "." + pick(names) : "") + (chance(0.3) ? "<" + list(d - 1, 1, 2) + ">" : "");
  if (r < 0.24) return pick(kws);
  if (r < 0.30) return type(d - 1) + " | " + type(d - 1);
  if (r < 0.35) return type(d - 1) + " & " + type(d - 1);
  if (r < 0.41) return type(d - 1) + " extends " + type(d - 1) + " ? " + type(d - 1) + " : " + type(d - 1);
  if (r < 0.46) return pick(["keyof ", "readonly ", "unique ", "typeof "]) + type(d - 1);
  if (r < 0.50) return "infer " + pick(names) + (chance(0.5) ? " extends " + type(d - 1) : "");
  if (r < 0.56) return type(d - 1) + pick(["[]", "[" + type(d - 1) + "]", "!", "[][]"]);
  if (r < 0.62) return "(" + type(d - 1) + ")";
  if (r < 0.70) return (chance(0.2) ? pick(["new ", "abstract new ", "<T>", "new <T>", "<T extends A>"]) : "") + "(" + params(d - 1) + ") => " + (chance(0.2) ? pick(["asserts a", "asserts a is " + type(d - 1), "a is " + type(d - 1), "this is " + type(d - 1), "asserts this"]) : type(d - 1));
  if (r < 0.77) return "[" + tuple(d - 1) + "]";
  if (r < 0.83) return "{ " + members(d - 1) + " }";
  if (r < 0.86) return pick(["1", "-1", "1n", "-1n", "\"s\"", "true", "false", "`a`"]);
  if (r < 0.89) return "`a${" + type(d - 1) + "}b" + (chance(0.3) ? "${" + type(d - 1) + "}" : "") + "`";
  if (r < 0.93) return (chance(0.3) ? "typeof " : "") + "import(\"m\"" + (chance(0.2) ? ", { with: { a: \"b\" } }" : "") + ")" + (chance(0.5) ? "." + pick(names) : "") + (chance(0.3) ? "<" + type(d - 1) + ">" : "");
  if (r < 0.96) return pick(names) + " is " + type(d - 1);
  return pick(["| ", "& "]) + type(d - 1);
}
function list(d, min, max) { const n = min + Math.floor(rnd() * (max - min + 1)); const out = []; for (let i = 0; i < n; i++) out.push(type(d)); return out.join(", "); }
function params(d) {
  const n = Math.floor(rnd() * 3); const out = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    let p = r < 0.6 ? pick(names) : r < 0.7 ? "this" : r < 0.8 ? "[" + pick(names) + ", " + pick(names) + "]" : r < 0.9 ? "{ " + pick(names) + (chance(0.5) ? ": " + pick(names) : "") + " }" : pick(["readonly", "public", "static", "keyof", "infer", "asserts", "is"]) + (chance(0.5) ? " " + pick(names) : "");
    if (chance(0.15)) p = "..." + p;
    if (chance(0.2)) p += "?";
    if (chance(0.6)) p += ": " + type(d);
    out.push(p);
  }
  return out.join(", ");
}
function tuple(d) {
  const n = Math.floor(rnd() * 4); const out = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    out.push(r < 0.4 ? type(d) : r < 0.55 ? pick([...names, ...odd]) + ": " + type(d) : r < 0.65 ? pick([...names, ...odd]) + "?: " + type(d) : r < 0.75 ? "..." + type(d) : r < 0.85 ? type(d) + "?" : r < 0.92 ? "..." + pick([...names, ...odd]) + ": " + type(d) : pick(odd) + pick(["", "?"]));
  }
  return out.join(", ");
}
function members(d) {
  const n = Math.floor(rnd() * 3); const out = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    out.push(r < 0.4 ? pick(names) + (chance(0.3) ? "?" : "") + ": " + type(d) : r < 0.55 ? "[" + pick(names) + ": string]: " + type(d) : r < 0.7 ? "[" + pick(names) + " in " + type(d) + "]" + pick(["", "?", "+?", "-?"]) + ": " + type(d) : r < 0.85 ? pick(names) + "(" + params(d) + "): " + type(d) : "[" + pick(["keyof", "readonly", "infer", "in", "K"]) + pick([": string", " in A", ""]) + "]: " + type(d));
  }
  return out.join("; ");
}
function tokens(s) { return s.match(/`[^`$]*\$\{|\}[^`$]*\$\{|\}[^`$]*`|`[^`]*`|"[^"]*"|=>|\.\.\.|[A-Za-z_$#][A-Za-z0-9_$]*|\d+n?|\n|\S/g) || []; }
function mutate(s) {
  const t = tokens(s); if (!t.length) return s;
  const i = Math.floor(rnd() * t.length); const r = rnd();
  const tok = () => pick(chance(0.5) ? punct : chance(0.5) ? odd : [...names, ...kws]);
  if (r < 0.3) t.splice(i, 1); else if (r < 0.6) t[i] = tok(); else if (r < 0.9) t.splice(i, 0, tok()); else t.splice(i, 0, t[i]);
  return t.join(" ");
}
const enc = s => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
const out = new Set();
while (out.size < count) {
  let s = type(1 + Math.floor(rnd() * 3));
  const m = rnd();
  if (m < 0.45) s = mutate(s); else if (m < 0.6) s = mutate(mutate(s));
  if (s.length > 0 && s.length < 160 && !/^\s*$/.test(s)) out.add(enc(s));
}
process.stdout.write([...out].join("\n") + "\n");
