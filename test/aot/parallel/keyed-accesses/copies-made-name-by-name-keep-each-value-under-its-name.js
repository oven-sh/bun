// `target[name] = source[name]`: each name takes what the source holds under that name, whatever the names are and wherever they come from.
const lines = [];
function say(label, value) { lines.push(label + ": " + value); }
function show(object) { return JSON.stringify(object, (key, value) => typeof value === "function" ? "function " + value.name : value === undefined ? "undefined" : value); }

function Node(start) { this.type = "Node"; this.start = start; this.end = 0; }
function copyNode(node) { const copy = new Node(node.start); for (const name in node) copy[name] = node[name]; return copy; }
const original = new Node(1);
original.body = [1, 2, 3];
original.key = new Node(2);
original.visit = function visit() { return this.body.length; };
const copy = copyNode(original);
copy.body.push(4);
say("copy", show(copy));
say("calls", copy.visit() + " " + copy.key.type + " " + copy.type.length + " " + (copy.body === original.body));

const defaults = { version: null, program: null, onToken: null, locations: false, ranges: false, name: "default" };
function optionsOf(given) {
  const options = {};
  for (const name in defaults) options[name] = given && Object.hasOwn(given, name) ? given[name] : defaults[name];
  return options;
}
const tokens = [];
const chosen = optionsOf({ version: "latest", onToken(token) { tokens.push(token); }, unused: 1 });
if (chosen.onToken) chosen.onToken("a");
say("options", show(chosen) + " " + tokens + " " + show(optionsOf()) + " " + (chosen.program || "no program"));

// Names that mean something to the engine.
const odd = { constructor: 1, toString: 2, hasOwnProperty: 3, ["__proto__"]: { marked: true }, valueOf: 4 };
const intoPlain = {};
for (const name in odd) intoPlain[name] = odd[name];
say("odd names", Object.keys(intoPlain).join(",") + " " + intoPlain.marked + " " + intoPlain.constructor + " " + typeof intoPlain.toString + " " + (Object.getPrototypeOf(intoPlain) === odd["__proto__"]));

// A name out of one object read from another, which inherits it.
const wanted = { toString: 0, push: 0, length: 0, missing: 0 };
const fromList = {};
for (const name in wanted) fromList[name] = [1, 2][name];
say("from a list", typeof fromList.toString + " " + typeof fromList.push + " " + fromList.length + " " + fromList.missing + " " + fromList.push.call([], 1));
const fromFunction = {};
for (const name in { name: 0, length: 0, prototype: 0, call: 0 }) fromFunction[name] = copyNode[name];
say("from a function", fromFunction.name + " " + fromFunction.length + " " + typeof fromFunction.prototype + " " + typeof fromFunction.call);

// Getters and setters run.
let log = "";
const withGetter = { get a() { log += "get a;"; return { inner: 1 }; }, b: 2 };
const withSetter = { set a(value) { log += "set a " + value.inner + ";"; }, set b(value) { log += "set b " + value + ";"; } };
for (const name in withGetter) withSetter[name] = withGetter[name];
say("accessors", log + show(withSetter));

// What is stored was read in an earlier turn.
const shifted = {}; let earlier;
const letters = { a: "A", b: "B", c: "C" };
for (const name in letters) { shifted[name] = earlier; earlier = letters[name]; }
say("one turn late", show(shifted));
const kept = {}; let last = letters.a;
for (const name in letters) { if (name !== "b") last = letters[name]; kept[name] = last; }
say("kept from an earlier turn", show(kept));

// The key changes between the read and the store.
const moved = {};
for (let name in letters) { const value = letters[name]; name = name + name; moved[name] = value; }
say("another key", show(moved));

// Many names.
const many = {}; for (let index = 0; index < 50; index++) many["n" + index] = index % 2 ? index : { index };
const wide = { n0: { index: -1 }, n1: 1, n2: { index: -2 }, n3: 3, n4: { index: 4 }, n5: 5, n6: { index: 6 }, n7: 7, n8: { index: 8 }, n9: 9, n10: { index: 10 }, n11: 11, n12: { index: 12 }, n13: 13, n14: { index: 14 }, n15: 15, n16: { index: 16 }, n17: 17,
  n18: { index: 18 }, n19: 19, n20: { index: 20 }, n21: 21, n22: { index: 22 }, n23: 23, n24: { index: 24 }, n25: 25, n26: { index: 26 }, n27: 27, n28: { index: 28 }, n29: 29, n30: { index: 30 }, n31: 31, n32: { index: 32 }, n33: 33, n34: function last() { return "called"; } };
const wideCopy = {};
for (const name in wide) wideCopy[name] = wide[name];
say("many names", wideCopy.n34() + " " + wideCopy.n32.index + " " + (wideCopy.n33 + 1) + " " + wideCopy.n0.index);
const manyCopy = {};
for (const name in many) manyCopy[name] = many[name];
say("names made at run time", manyCopy.n48.index + " " + manyCopy.n49);

// The names come from a list.
const byKeys = {};
for (const name of Object.keys(letters)) byKeys[name] = letters[name];
const first = Object.keys(letters)[5];
byKeys[first] = letters[first];
say("by keys", show(byKeys) + " " + ("undefined" in byKeys));
console.log(lines.join("\n"));
