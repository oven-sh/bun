// Functions made at run time store properties by name: new ones and old ones, in line and out of line, cells and numbers, on objects of every kind, while setters and read-only properties come and go in the chain.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const literal = new Function("a", "b", "c", "return { a, b, c, d: { a, list: [b] }, e: 1.5, f: 'text', g: null, h: undefined, i: true };");
const fill = new Function("target", "value", "target.one = value; target.two = value; target.three = value; return target;");
const many = new Function("target", "value", Array.from({ length: 40 }, (_, i) => "target.p" + i + " = value + " + i + ";").join(" ") + " return target;");
const set = new Function("target", "value", "target.held = value; return target.held;");
const strict = new Function("target", "value", "'use strict'; target.held = value; return target.held;");
const show = value => {
  try {
    return JSON.stringify(value, (key, inner) => (typeof inner === "bigint" ? inner + "n" : typeof inner === "function" ? "function" : inner === undefined ? "undefined" : inner));
  } catch (error) {
    return "unprintable";
  }
};
const say = (label, run) => {
  const seen = [];
  for (let turn = 0; turn < 5; turn++) {
    try {
      seen.push(show(run(turn)));
    } catch (error) {
      seen.push("throws " + error.constructor.name);
    }
  }
  lines.push(label + ": " + seen.join(" "));
};
say("a literal", turn => literal(turn, "b" + turn, { turn }));
say("three new names", turn => fill({}, turn));
say("three new names behind one", turn => fill({ zero: 0 }, [turn]));
say("three old names", turn => fill({ one: 0, two: 0, three: 0 }, "s" + turn));
say("forty names", turn => many({}, turn));
say("forty names on an array", turn => Object.entries(many([1], turn)).length);
say("forty names on a function", turn => Object.keys(many(function () {}, turn)).length);
for (const [name, store] of [["sloppy", set], ["strict", strict]]) {
  say(name + " a plain object", turn => store({}, turn));
  say(name + " no prototype", turn => store(Object.create(null), turn));
  say(name + " frozen", turn => store(Object.freeze({ held: "frozen" }), turn));
  say(name + " frozen and empty", turn => store(Object.freeze({}), turn));
  say(name + " sealed", turn => store(Object.seal({ held: "sealed" }), turn));
  say(name + " not extensible", turn => store(Object.preventExtensions({}), turn));
  say(name + " read-only", turn => store(Object.defineProperty({}, "held", { value: "fixed" }), turn));
  say(name + " read-only in the chain", turn => store(Object.create(Object.defineProperty({}, "held", { value: "fixed" })), turn));
  say(name + " a setter", turn => { const seen = []; store({ set held(v) { seen.push(v); } }, turn); return seen; });
  say(name + " a setter in the chain", turn => { const seen = []; const target = Object.create({ set held(v) { seen.push(v, this === target); } }); store(target, turn); return [seen, Object.keys(target)]; });
  say(name + " a getter alone", turn => store({ get held() { return "got"; } }, turn));
  say(name + " a proxy", turn => { const seen = []; store(new Proxy({}, { set(t, k, v) { seen.push(k, v); return true; } }), turn); return seen; });
  say(name + " a proxy in the chain", turn => { const seen = []; store(Object.create(new Proxy({}, { set(t, k, v) { seen.push(k, v); return true; } })), turn); return seen; });
  say(name + " a string", turn => store("text", turn));
  say(name + " a number", turn => store(5, turn));
  say(name + " undefined", turn => store(undefined, turn));
  say(name + " null", turn => store(null, turn));
  say(name + " an array", turn => store([], turn));
  say(name + " a typed array", turn => store(new Uint8Array(1), turn));
  say(name + " a map", turn => store(new Map(), turn));
}
const parent = {}, children = () => Object.create(parent);
say("before the parent has a setter", turn => Object.keys(fill(children(), turn)));
let caught = 0;
Object.defineProperty(parent, "two", { set(v) { caught += 1; }, configurable: true });
say("while it has one", turn => Object.keys(fill(children(), turn)));
delete parent.two;
say("after it lost it", turn => Object.keys(fill(children(), turn)));
Object.defineProperty(parent, "three", { value: "fixed", configurable: true });
say("while a name is read-only there", turn => Object.keys(fill(children(), turn)));
delete parent.three;
say("after that too", turn => Object.keys(fill(children(), turn)));
lines.push("caught " + caught);

class Point { constructor(x, y) { this.x = x; this.y = y; } }
const move = new Function("point", "dx", "point.x = point.x + dx; point.y = point.y - dx; point.moved = true; return point;");
say("an instance", turn => move(new Point(turn, 1.5), 2));
const old = [];
for (let i = 0; i < 200; i++) old.push({});
collect();
let sum = 0;
for (let round = 0; round < 50; round++) {
  for (let i = 0; i < old.length; i++) {
    const target = round % 10 === 0 ? (old[i] = {}) : old[i];
    fill(target, { round, i });
    sum += target.one.round + target.three.i;
  }
  if (round % 9 === 8) collect();
}
lines.push("sum " + sum);
console.log(lines.join("\n"));
