// A class declares nothing of five names, one instance gets them, so every instance has room for them, each in the form of its type. The others read them as what is above them says, warm, under many shapes and under one: then what is above changes
class Point {
  constructor(i, ownName) { if (ownName) this["own" + i] = i; this.x = i; }
  norm() { return this.x * 2; }
}
const many = [], alike = [];
for (let i = 0; i < 300; i++) { many.push(new Point(i, true)); alike.push(new Point(i, false)); }
for (const p of [many[4], alike[4]]) { p.whole = 1; p.real = 1.5; p.flag = true; p.text = "mine"; p.list = [1]; }
const names = ["whole", "real", "flag", "text", "list"];
function read(p) { return [p.whole, p.real, p.flag, p.text, p.list]; }
function has(p) { return ("whole" in p) + ("real" in p) * 2 + ("flag" in p) * 4 + ("text" in p) * 8 + ("list" in p) * 16; }
function tally(label) {
  const seen = new Map();
  for (let round = 0; round < 40; round++) {
    for (const list of [many, alike]) {
      for (const p of list) {
        const key = read(p).map(v => typeof v + ":" + String(v)).join(" ") + " in:" + has(p);
        seen.set(key, (seen.get(key) || 0) + 1);
      }
    }
  }
  console.log(label);
  for (const [k, n] of [...seen].sort()) console.log("  ", k, "x" + n);
}
const each = change => { for (const name of names) change(name); };
tally("nothing above has them:");
each(name => { Point.prototype[name] = 1; });
tally("the prototype gets values:");
each(name => { Point.prototype[name] = 2.5; });
tally("the values are replaced:");
each(name => { delete Point.prototype[name]; });
tally("the values are deleted:");
each(name => { Object.defineProperty(Point.prototype, name, { get() { return this.x & 1 ? "odd" : "even"; }, configurable: true }); });
tally("the prototype gets getters:");
each(name => { delete Point.prototype[name]; });
tally("the getters are deleted:");
const above = { whole: 5, real: 5, flag: 5, text: 5, list: 5 };
Object.setPrototypeOf(Point.prototype, above);
tally("an object that has them comes between:");
each(name => { above[name] = "other"; });
tally("its values are replaced by values of another type:");
each(name => { delete above[name]; });
tally("it loses the names:");
Object.setPrototypeOf(above, { get whole() { return 7; }, get real() { return 7; }, get flag() { return 7; }, get text() { return 7; }, get list() { return 7; } });
tally("getters come further up:");
Object.setPrototypeOf(Point.prototype, Object.prototype);
tally("all that came between goes:");
for (const p of [many[9], alike[9]]) each(name => { p[name] = undefined; });
tally("an instance gets them as undefined:");
for (const p of [many[4], alike[4]]) each(name => { delete p[name]; });
tally("the first instance loses them:");
Object.setPrototypeOf(Point.prototype, null);
tally("nothing is above the prototype:");
