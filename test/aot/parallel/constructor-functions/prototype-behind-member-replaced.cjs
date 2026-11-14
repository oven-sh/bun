// The prototype that a namespace settled is replaced or changed later.
const seen = [], lines = [];
function log(...words) { console.log(...words); }
if (typeof NS == "undefined") var NS = {};
if (typeof NS.other == "undefined") NS.other = {};
function look() { try { seen.push(new NS.V(6)); } catch (e) { log("looked", e.constructor.name); } }
try {
NS.V = function (x) { this.x = x; this.y = 2; };

NS.V.prototype = { initialize: function (x) { this.x = x; this.y = 1; }, sum: function () { return this.x + this.y; }, twice: function (a) { return a * 2; } };
} catch (error) { log("ended", error.constructor.name); }
const keep = [];
function make(x) { return new NS.V(x); }
function named(a) { return NS.V.prototype.twice(a); }
function run(count) {
  let total = 0, words = "";
  for (let i = 0; i < count; i++) {
    const a = new NS.V(i);
    const b = make(i + 0.5);
    keep[i & 3] = b;
    const s = a.sum();
    if (typeof s === "number") total += s + b.sum(); else words += s;
    const t = NS.V.prototype.twice(i);
    if (typeof t === "number") total += t;
    total += named(i) === t ? 1 : 0;
  }
  return total + words.slice(0, 40);
}
const show = made => { try { return Object.keys(made).join() + ":" + made.x + ":" + (typeof made.sum === "function" ? made.sum() : made.sum) + ":" + made.kind; } catch (e) { return e.constructor.name; } };
const all = () => {
  try { log(run(20)); } catch (error) { log("run", error.constructor.name, error.message.slice(0, 20)); }
  try { log(named(4)); } catch (error) { log("named", error.constructor.name); }
  log(seen.map(show).join(" "), keep.map(show).join(" "), typeof early === "object" ? early.map(show).join() : "");
};
all();
try { Reflect.set(NS.V, ["proto", "type"].join(""), { initialize: function (x) { this.y = x; this.x = 0; }, sum: function () { return "replaced " + this.y; }, twice: function () { return "r"; } }); } catch (error) { log("behind", error.constructor.name); }
all();
for (const made of seen) log(Object.getPrototypeOf(made) === (NS && NS.V && NS.V.prototype));
