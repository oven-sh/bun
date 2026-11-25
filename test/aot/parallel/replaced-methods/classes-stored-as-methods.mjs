// A class that a program stores over a method, and that may be evaluated again, has no class object before its first evaluation: a loop in front of the store makes none.
// COUNT: operation:operationAOTSingletonClosure = 0
const show = (label, f) => {
  let r;
  try {
    r = f();
  } catch (e) {
    r = `${e.name}: ${e.message}`;
  }
  console.log(label, String(r));
};
class Before { k = 3; m(n) { return n + this.k; } }
let before = new Before();
function run() { let s = 0; for (let i = 0; i < 200; i++) s += before.m(i & 3); return s; }
show("method", run);
const store = label => { Before.prototype.m = class { static label = label; static told() { return label + this.label; } }; return Before.prototype.m; };
const stored = [];
show("first", () => { stored.push(store("a")); });
show("class", run);
show("second", () => { stored.push(store("b")); });
show("class again", run);
show("told", () => stored.map(it => it.told()).join() + " " + (stored[0] === stored[1]) + " " + (Before.prototype.m === stored[1]));
before = new Before();
show("another object", run);
show("made", () => new before.m() instanceof stored[1]);
