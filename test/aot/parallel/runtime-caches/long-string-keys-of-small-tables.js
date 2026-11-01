const box = JSON.parse("[0]");
function hidden(value) {
  box[0] = value;
  return box[0];
}
const lines = [];
function say(label, ...values) {
  lines.push(label + ": " + values.map(String).join(" "));
}

const length = JSON.parse("3000");
const head = hidden("k".repeat(length - 1));
const half = hidden("k".repeat((length - 2) / 2));
const wideHead = hidden("Ж".repeat(length - 1));
const forms = [
  ["flat", tail => [head, tail].join("")],
  ["joined", tail => head + tail],
  ["joined of three", tail => half + half + "k" + tail],
  ["parsed", tail => JSON.parse('"' + head + tail + '"')],
];

function ask(label, table, tails) {
  for (const [form, create] of forms) {
    const answers = [];
    for (const tail of tails) {
      const key = create(tail);
      answers.push(tail + "=" + table[key] + "," + (key in table) + "," + Object.hasOwn(table, key));
    }
    say(label + ", " + form, answers.join(" "));
  }
}

const one = { short: 0 };
one[head + "a"] = "one a";
ask("one name of the length", one, ["a", "b", "aa", ""]);

const two = {};
two[head + "a"] = "two a";
two[head + "b"] = "two b";
ask("two names of the length", two, ["a", "b", "c", "aa"]);

const none = { short: 1, other: 2 };
ask("no name of the length", none, ["a", "aa"]);

const above = {};
above[head + "a"] = "above a";
const below = Object.create(above);
below[head + "bb"] = "below bb";
ask("a name above", below, ["a", "bb", "b"]);

const shadowing = Object.create(above);
shadowing[head + "a"] = "shadowing a";
ask("the same name twice on the chain", shadowing, ["a", "b"]);

let asked = 0;
const answering = new Proxy(
  {},
  {
    get(target, key) {
      asked++;
      return "proxy " + key.length;
    },
    has(target, key) {
      asked++;
      return key.length === length;
    },
  },
);
const smallBelowProxy = Object.create(answering);
smallBelowProxy.short = 1;
ask("a small table below a proxy", smallBelowProxy, ["a", "aa"]);
const crowdedBelowProxy = Object.create(answering);
for (let i = 0; i < 400; i++) crowdedBelowProxy["n" + i] = i;
ask("a crowded table below a proxy", crowdedBelowProxy, ["a", "aa"]);
say("the proxy was asked", asked);

const crowded = {};
for (let i = 0; i < 400; i++) crowded["n" + i] = i;
crowded[head + "a"] = "crowded a";
ask("a crowded table", crowded, ["a", "b"]);

const withGetter = {};
Object.defineProperty(withGetter, head + "a", { get() { return "got by " + (this === withGetter); }, enumerable: true });
ask("a getter", withGetter, ["a", "b"]);

const withSymbol = { [Symbol(head + "a")]: "symbol" };
ask("a symbol described by the text", withSymbol, ["a"]);

const wide = {};
wide[wideHead + "a"] = "wide a";
say("a wide name", wide[wideHead + "a"], wide[[wideHead, "a"].join("")], wide[wideHead + "b"], wide[head + "a"], one[wideHead + "a"]);
const narrowTextInWideString = hidden((head + "aЖ").slice(0, length));
say("a narrow text cut out of a wide one", narrowTextInWideString.length, one[narrowTextInWideString], narrowTextInWideString in one);

const kept = [head, "a"].join("");
const seen = [];
for (let i = 0; i < 6; i++) seen.push(one[kept]);
say("one key object again and again", seen.join(","), kept.length, kept === head + "a", kept.charCodeAt(length - 1));
delete one[kept];
say("behind a delete", one[kept], kept in one, one[head + "a"]);
one[kept] = "again";
say("behind a store", one[kept], one[head + "a"], Object.keys(one).length);

const stored = {};
for (const [form, create] of forms) stored[create("a")] = form;
say("stores under every form", Object.keys(stored).length, stored[head + "a"]);
for (const [form, create] of forms) stored[create(form.length % 2 ? "b" : "c")] = form;
say("stores under two more names", Object.keys(stored).length, stored[head + "b"], stored[head + "c"]);
for (const [, create] of forms) say("deleted", delete stored[create("a")], Object.keys(stored).length);

class Point {
  constructor() {
    this.x = 1;
  }
}
const point = new Point();
ask("an instance without the name", point, ["a"]);
point[head + "a"] = "point a";
ask("an instance with the name", point, ["a", "b"]);

console.log(lines.join("\n"));
