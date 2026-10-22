// `this.pos = pos; this.end = end; this.kind = kind`: each stored parameter is tested for a value that fits its slot. Whichever of the three fails, alone or with others, the object has its five properties in the order of the stores and holds what was passed, as in plain Bun; so it does with a setter, a read-only property or a frozen prototype above it.
function Span(kind, pos, end) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
}
const table = { Span };
const Constructor = table[JSON.parse('"Span"')];
const values = [1, 0, -1, -0, 2147483647, 2147483648, -2147483643, -2147483644, -2147483648, 1.5, NaN, Infinity, "text", "", undefined, null, true, 10n, Symbol.iterator, [7], { valueOf: () => 3 }];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "symbol") return value.description;
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value + "]" : "{}";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
function describe(span) {
  let text = "";
  for (const key of Object.keys(span)) text += key + "=" + show(span[key]) + " ";
  return text;
}
function hash(text, seed) {
  let h = seed | 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}
function roundThatMayThrow(label) {
  // Integers first, so that the stores by slot are what runs.
  let sum = 0;
  for (let k = 0; k < 2000; k++) {
    const span = new Constructor(k & 7, k, k + 3);
    sum = (sum + span.end - span.pos + span.kind + span.id + span.flags) | 0;
  }
  let all = 0;
  for (const kind of values) {
    let line = 0;
    for (const pos of values) for (const end of values) line = hash(describe(new Constructor(kind, pos, end)), line);
    all = hash(String(line), all);
  }
  console.log(label, sum, all, describe(new Constructor(1, "p", 2)), "|", describe(new Constructor(1, 2, "e")), "|", describe(new Constructor("k", 1, 2)), "|", describe(new Constructor(1.5, 2.5, 3.5)));
}

function round(label) {
  try {
    roundThatMayThrow(label);
  } catch (error) {
    console.log(label, "throws", error.constructor.name);
  }
}

round("plain");
const seen = [];
Object.defineProperty(Span.prototype, "end", { set(value) { seen.push(show(value)); }, get() { return "from above"; }, configurable: true });
round("a setter above");
console.log(seen.length, seen.slice(-4).join());
delete Span.prototype.end;
Object.defineProperty(Span.prototype, "kind", { value: "fixed", writable: false, configurable: true });
round("a read-only property above");
delete Span.prototype.kind;
Object.freeze(Span.prototype);
round("a frozen prototype");
console.log(describe(Reflect.construct(Constructor, [1, 2, 3], function Other() {})), Object.keys(new Constructor()).join());
