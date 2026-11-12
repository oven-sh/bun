// A function that call() and apply() enter more than once makes a class each time.
const lines = []; const say = (...v) => lines.push(v.join(" "));
const made = [];
function library(name) {
  var registry = { name, count: 0 };
  function Item(x) { this.x = x; this.y = registry.count++; }
  Item.prototype.get = function () { return registry.name + this.x + this.y; };
  Item.prototype.put = function (v) { this.x = v; return this; };
  made.push({ Item, registry });
}
library.call(null, "a");
library.call(null, "b");
(function (make) { make.apply(null, ["c"]); make.call(null, "d"); })(function (name) { var log = { name }; function Other(x) { this.x = x; log.last = x; } Other.prototype.get = function () { return log.name + this.x; }; made.push({ Item: Other, registry: log }); });
function look(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; r += o.get() + "," + o.x + "," + o.y + ";"; } return r; }
function store(os) { for (let i = 0; i < os.length; i++) os[i].x = i * 2; return look(os); }
for (let t = 0; t < 3; t++) {
  const os = made.map((m, i) => new m.Item(i + t)); say(look(os), store(os), look(os.reverse()));
  say(os.map(o => made.map(m => +(o instanceof m.Item)).join("")).join(), made.map(m => JSON.stringify(m.registry)).join());
  if (t === 1) { made[0].Item.prototype.get = function () { return "changed" + this.x; }; made[3].Item.prototype.get = () => "d!"; }
}
for (const l of lines) console.log(l);
