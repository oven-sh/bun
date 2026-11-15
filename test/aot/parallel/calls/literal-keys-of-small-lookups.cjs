// A small function that looks up the name that it is passed, and throws where it is absent, is copied where the name is a literal.
// COUNT: operation:operationAOTInByValAndCache <= 15
function argument(object, name, otherwise) {
  if (name in object) return object[name];
  else if (arguments.length === 3) return otherwise;
  throw new Error('"' + name + '" is a required argument.');
}
class Rows {
  constructor() { this.rows = []; }
  add(object) {
    const from = argument(object, "from");
    const to = argument(object, "to", null);
    const name = argument(object, "name", undefined);
    this.rows.push(String(from) + "|" + String(to) + "|" + String(name));
  }
  zero(object) { return argument(object, "0", "none") + "/" + argument(object, "length", -1); }
}
const rows = new Rows();
const calls = [];
const inherited = Object.create({ get to() { calls.push("get"); return "t" + calls.length; } }, { from: { get() { return this === inherited; } } });
const proxy = new Proxy({ from: 1, name: "n" }, {
  has(target, key) { calls.push("has " + String(key)); return key in target; },
  get(target, key) { calls.push("get " + String(key)); return target[key]; },
});
const bare = Object.create(null);
bare.from = "bare";
const late = { from: 0 };
late.name = "late";
if (calls.length === 0) late.to = { toString() { return "to"; } };
const objects = [{ from: 1, to: 2 }, { to: 1 }, inherited, proxy, bare, late, Object.freeze({ from: -0, name: null }), ["a", "b"], "text", undefined, 7, function from() {}];
for (let round = 0; round < 3; round++) {
  for (const object of objects) {
    try { rows.add(object); } catch (error) { rows.rows.push(error.name + " " + (error instanceof TypeError ? "" : error.message)); }
    try { rows.rows.push(rows.zero(object)); } catch (error) { rows.rows.push(error.name); }
  }
  objects[7].from = "above" + round;
}
console.log(rows.rows.join("\n"));
console.log(calls.join());
