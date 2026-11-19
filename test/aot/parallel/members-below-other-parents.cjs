// A class below a mixin that is evaluated again, or below a parent that changes, answers for the names it declares. Inherited names follow what stands above.
const log = [];
const keys = new Map("get twice wide put tag name far all size constructor".split(" ").map(key => [key, key]));
function change(holder, key, value) { Reflect.set(holder, keys.get(key), value); }
function relink(holder, parent) { Reflect.setPrototypeOf(holder, parent); }
const say = (...words) => log.push(words.join(" "));
function mix(Base) {
  if (Base === undefined) Base = Object;
  class Mixed extends Base {
    get(i) { return -1 - i; }
    twice(i) { return this.get(i) * 2; }
    get wide() { return 7; }
    static tag() { return "mixed"; }
  }
  for (const name of ["one", "two"]) Mixed.prototype[name] = Mixed.prototype.twice;
  return Mixed;
}
class View extends mix() {
  constructor(list) { super(); this.list = list; }
  get(i) { return this.list[i & 3]; }
  put(i, v) { this.list[i & 3] = v; return this; }
  static tag() { return "view"; }
}
class List extends mix(Array) {
  constructor(list) { super(); this.list = list; }
  get(i) { return this.list[i & 3] + 10; }
  put(i, v) { this.list[i & 3] = v; return this; }
}
class Below extends List {
  twice(i) { return super.twice(i) + 1; }
  static tag() { return super.tag() + " below"; }
}
class Deep extends Below {
  get(i) { return super.get(i) + 100; }
  get wide() { return super.wide + 1; }
}
function Old(list) { this.list = list; }
Old.prototype = Object.create(View.prototype);
Old.prototype.constructor = Old;
Old.prototype.get = function (i) { return this.list[i & 3] - 5; };
class Root { name() { return "root"; } size(i) { return i; } get far() { return 1; } static tag() { return "root"; } static all() { return "all"; } }
class Branch extends Root { size(i) { return i + 1; } static tag() { return "branch"; } }
class Leaf extends Branch { far2() { return this.far + 1; } }
function branches(n) {
  const branch = new Branch(), leaf = new Leaf();
  let t = 0, words = "";
  for (let i = 0; i < n; i++) {
    t += branch.size(i) + leaf.size(i) * 3 + branch.far + leaf.far * 5 + leaf.far2() * 7;
    words = branch.name() + leaf.name() + Branch.tag() + Leaf.tag() + Branch.all() + Leaf.all();
  }
  return t + words;
}
const objects = [new View([1, 2, 3, 4]), new List([1, 2, 3, 4]), new Below([1, 2, 3, 4]), new Deep([1, 2, 3, 4]), new Old([1, 2, 3, 4])];
function gets(o, n) { let t = 0; for (let i = 0; i < n; i++) t += o.get(i); return t; }
function puts(o, n) { let t = 0; for (let i = 0; i < n; i++) { o.put(i, i & 7); t += o.get(i + 1); } return t; }
function inherited(o, n) { let t = 0; for (let i = 0; i < n; i++) t += o.twice(i) + o.one(i) + o.wide; return t; }
function direct(n) {
  const view = new View([4, 3, 2, 1]), list = new List([4, 3, 2, 1]), deep = new Deep([4, 3, 2, 1]);
  let t = 0;
  for (let i = 0; i < n; i++) t += view.get(i) + list.get(i) * 3 + deep.get(i) * 7 + view.twice(i) + list.twice(i) + deep.twice(i);
  return t;
}
function made(o) { return o.constructor === undefined ? "none" : o.constructor.name; }
function round(title) {
  for (const n of [2, 50]) {
    for (const o of objects) {
      for (const f of [gets, puts, inherited, made]) {
        let answer;
        try { answer = f(o, n); } catch (error) { answer = error.name; }
        say(title, f.name, answer);
      }
    }
    let answer;
    try { answer = direct(n) + [View, List, Below, Deep].map(C => C.tag()).join(); } catch (error) { answer = error.name; }
    say(title, answer);
    try { answer = branches(n); } catch (error) { answer = error.name; }
    say(title, answer);
  }
}
round("first");
const Third = mix(Map);
objects.push(new (class extends Third { constructor() { super(); this.list = [9, 8, 7, 6]; } get(i) { return i; } put() { return this; } })());
round("a third evaluation");
change(Object.getPrototypeOf(List.prototype), "get", function (i) { return 1000; });
round("the mixin's member");
change(Object.getPrototypeOf(List.prototype), "twice", function (i) { return 2000; });
round("an inherited member");
Object.defineProperty(Object.getPrototypeOf(View.prototype), keys.get("wide"), { get() { return 70; }, configurable: true });
round("an accessor above");
relink(Below.prototype, { __proto__: View.prototype, twice(i) { return 3000; }, put(i, v) { this.list[i & 3] = v + 1; return this; } });
round("another parent");
change(Below.prototype, "get", function (i) { return 4000; });
round("a name below another parent");
change(List.prototype, "get", function (i) { return 5000; });
round("a declared member");
Reflect.deleteProperty(Deep.prototype, keys.get("get"));
round("a member gone");
change(View.prototype, "twice", function (i) { return 6000; });
round("a member added over an inherited one");
relink(Deep, { tag() { return "other"; } });
round("another class object above");
objects[0].get = function (i) { return 7000; };
round("an own member");
relink(objects[1], Old.prototype);
round("an instance below another prototype");
change(Old.prototype, "get", View.prototype.get);
round("a function's member");
Object.freeze(View.prototype);
try { View.prototype.get = null; } catch (error) { say(error.name); }
round("frozen");
View.prototype.constructor;
change(Deep.prototype, "constructor", View);
round("a constructor");
relink(Root.prototype, { late() { return 1; } });
round("the link of the class at the top");
change(Root.prototype, "name", function () { return "renamed"; });
Object.defineProperty(Root.prototype, keys.get("far"), { get() { return 50; }, configurable: true });
round("members of the class at the top");
change(Branch.prototype, "size", function (i) { return i + 1000; });
round("a declared member below it");
relink(Root, { none() { return 0; } });
change(Root, "all", function () { return "every"; });
round("static members of the class at the top");
relink(Branch, { all() { return "other"; } });
round("another class object above the one in the middle");
change(Branch, "tag", function () { return "changed"; });
round("a declared static member");
let hash = 0;
for (const line of log) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, hash);
console.log(log.filter((line, i) => i % 7 === 0).join("\n"));
