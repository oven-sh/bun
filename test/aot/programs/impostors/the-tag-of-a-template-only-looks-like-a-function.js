function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function join(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += "[" + values[i] + "]" + strings[i + 1];
  return out;
}

function tagOnce(tag, value) {
  return tag`a${value}b${value + 1}c`;
}

function stringsOf(tag) {
  return tag`x${0}y`;
}

function rawOf(tag) {
  return tag`\n${0}A\x`;
}

const keep = strings => strings;

function honest(round) {
  console.log(round, tagOnce(join, 1), tagOnce(join, "v"), tagOnce((strings, a, b) => strings.length + a + b, 1), join`plain`, join`${1}`, join`${1}${2}`);
}

const tags = [
  ["a bound function", () => join.bind(null)],
  ["a function bound to an array of its own", () => join.bind(null, ["<", "|", "|", "|", ">"])],
  ["a callable proxy", () => new Proxy(join, { apply: (target, self, list) => (log.push("apply " + list.length + " " + typeof self), Reflect.apply(target, self, list)) })],
  ["String.raw", () => String.raw],
  ["Array.of", () => Array.of],
  ["an async function", () => async strings => strings.length],
  ["a generator function", () => function* (strings, a) { yield strings[0] + a; }],
  ["a class", () => class {}],
  ["an object with call", () => ({ call: join })],
  ["a string", () => "join"],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of tags) attempt("the tag is " + name, () => tagOnce(make(), 1));
for (const [name, make] of tags) attempt("the tag is a member that holds " + name, () => { const holder = { tag: make() }; return holder.tag`a${1}b`; });

attempt("the strings are an array", () => [Array.isArray(stringsOf(keep)), stringsOf(keep).length, Object.isFrozen(stringsOf(keep)), Object.isFrozen(stringsOf(keep).raw)]);
attempt("one place hands over the same strings every time", () => stringsOf(keep) === stringsOf(keep));
attempt("two places with the same text do not", () => keep`x${0}y` === keep`x${0}y`);
attempt("whatever the tag is", () => stringsOf(keep) === stringsOf(keep.bind(null)));
attempt("a push to the strings", () => stringsOf(keep).push("z"));
attempt("a store to the strings", () => { stringsOf(keep)[0] = "changed"; return stringsOf(keep)[0]; });
attempt("a store to their length", () => { stringsOf(keep).length = 0; return stringsOf(keep).length; });
attempt("sorting the strings", () => stringsOf(keep).sort());
attempt("mapping the strings", () => stringsOf(keep).map(text => text + "!"));
attempt("an escape that is not valid", () => [rawOf(keep)[0], rawOf(keep)[1], rawOf(keep).raw[0], rawOf(keep).raw[1]]);
attempt("raw is not enumerable", () => [Object.keys(stringsOf(keep)), JSON.stringify(Object.getOwnPropertyDescriptor(stringsOf(keep), "raw").enumerable)]);

attempt("this of a plain tag", () => (function () { return typeof this; })`x`);
attempt("this of a member tag", () => ({ name: "holder", tag() { return this.name; } }).tag`x`);
attempt("this of a tag read by a computed name", () => ({ name: "holder", tag() { return this.name; } })["t" + "ag"]`x`);
attempt("a tag that answers a tag", () => (() => join)`first``second${1}`);
attempt("new on the result of a tag", () => typeof new (() => function () {})`x`());
attempt("the values are evaluated in order before the call", () => ((...list) => (log.push("called"), list.length))`${log.push("first")}${log.push("second")}`);
attempt("and before a tag that is not callable throws", () => (void 0)`${log.push("first")}${log.push("second")}`);
attempt("the tag is read before the values", () => ({ get tag() { log.push("get tag"); return join; } }).tag`${log.push("value")}`);
attempt("values that are not strings are handed over as they are", () => ((strings, ...values) => values.map(value => typeof value))`${1}${"s"}${null}${undefined}${{}}${1n}${Symbol.iterator}`);
attempt("without a tag they are converted", () => `${1}${"s"}${null}${undefined}${{}}${1n}`);
attempt("without a tag a symbol throws", () => `${Symbol.iterator}`);
for (let i = 0; i < 2000; i++) tagOnce(join, i);
for (const [name, make] of tags) attempt("after 2000 honest tags, the tag is " + name, () => tagOnce(make(), 1));
honest("after");
