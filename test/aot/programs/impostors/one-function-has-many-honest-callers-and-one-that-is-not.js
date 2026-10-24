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

function shorten(text) {
  return text.length > 5 ? text.slice(0, 5) + "..." : text;
}

function codeSum(text) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}

function title(text) {
  return text[0].toUpperCase() + text.substring(1);
}

const lookAlike = make("({ length: 9, slice() { return 'sliced'; }, charCodeAt() { return 1; }, 0: { toUpperCase() { return 'UP'; } }, substring() { return 'sub'; } })");
const list = make("['first', 'second', 'third', 'fourth', 'fifth', 'sixth']");

function honestCallerOne() {
  return [shorten("hello world"), codeSum("abc"), title("hello")];
}

function honestCallerTwo() {
  return [shorten("hi"), codeSum(""), title("x")];
}

function honestCallerThree(name) {
  return [shorten("dear " + name), codeSum("dear " + name), title("dear " + name)];
}

const tools = { shorten, codeSum, title };
const inAList = [shorten, codeSum, title];

class Formatter {
  constructor(format) {
    this.format = format;
  }
  run(value) {
    return this.format(value);
  }
}

function apply(format, value) {
  return format(value);
}

attempt("an honest caller before", honestCallerOne);
attempt("a plain call with the look-alike before any loop", () => [shorten(lookAlike), codeSum(lookAlike), title(lookAlike)]);

for (let i = 0; i < 2000; i++) {
  honestCallerOne();
  honestCallerTwo();
  honestCallerThree("ada");
}

attempt("honest caller one", honestCallerOne);
attempt("honest caller two", honestCallerTwo);
attempt("honest caller three", () => honestCallerThree("grace"));
attempt("a plain call", () => [shorten(lookAlike), codeSum(lookAlike), title(lookAlike)]);
attempt("a plain call with a list", () => [shorten(list), codeSum(Object.assign(["a"], { charCodeAt: () => 5 })), title(Object.assign(["word"], { substring: () => "!" }))]);
attempt("call", () => [shorten.call(null, lookAlike), codeSum.call(undefined, lookAlike), title.call({}, lookAlike)]);
attempt("apply", () => [shorten.apply(null, [lookAlike]), codeSum.apply(null, [lookAlike]), title.apply(null, [lookAlike])]);
attempt("apply with an array-like", () => shorten.apply(null, { length: 1, 0: lookAlike }));
attempt("bind", () => [shorten.bind(null, lookAlike)(), codeSum.bind(null)(lookAlike), title.bind(null, lookAlike)("ignored")]);
attempt("Reflect.apply", () => Reflect.apply(shorten, null, [lookAlike]));
attempt("handed to map", () => [lookAlike, "hello world", list].map(shorten));
attempt("handed to map, which also passes an index and the list", () => ["abc", lookAlike].map(codeSum));
attempt("handed to forEach", () => {
  const seen = [];
  [lookAlike, "hello"].forEach(value => seen.push(title(value)));
  return seen;
});
attempt("handed to replace", () => "a long enough text".replace(/.+/, shorten));
attempt("handed to replace with a group that took no part", () => "abc".replace(/(x)?abc/, (match, group) => shorten(group)));
attempt("handed to sort", () => [lookAlike, "zz", "a"].sort((a, b) => codeSum(a) - codeSum(b)).map(value => typeof value));
attempt("handed to Array.from", () => Array.from({ length: 2, 0: lookAlike, 1: "hello world" }, shorten));
attempt("a member read by name", () => tools.shorten(lookAlike));
attempt("a member read by a computed name", () => tools[make("'short' + 'en'")](lookAlike));
attempt("an element", () => inAList[make("0")](lookAlike));
attempt("a field", () => [new Formatter(shorten).run(lookAlike), new Formatter(shorten).run("hello world"), new Formatter(codeSum).run(lookAlike)]);
attempt("a parameter", () => [apply(shorten, lookAlike), apply(shorten, "hello world"), apply(title, lookAlike)]);
globalThis.shortenForEval = shorten;
globalThis.lookAlikeForEval = lookAlike;
attempt("from eval", () => (0, eval)("shortenForEval(lookAlikeForEval)"));
attempt("from new Function", () => new Function("format", "value", "return format(value)")(shorten, lookAlike));
attempt("from a getter", () => ({ get short() { return shorten(lookAlike); } }).short);
attempt("from a conversion", () => `${{ toString: () => shorten(lookAlike) }}`);
attempt("as a tag", () => shorten`hello world`);
attempt("as a constructor", () => typeof new shorten("hello world"));
attempt("with nothing", () => shorten());
attempt("with null", () => shorten(null));
attempt("with a number", () => [shorten(1234567), codeSum(1234567)]);
attempt("honest callers afterwards", () => [honestCallerOne(), honestCallerTwo(), honestCallerThree("ada")]);
Promise.resolve(lookAlike).then(shorten).then(result => attempt("a promise reaction", () => result));
