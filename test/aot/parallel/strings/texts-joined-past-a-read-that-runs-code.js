// numbers and written texts are joined with what a read gives that runs code: the getter logs, stores into the variable that the first part was read from, throws, gives an object that converts
let log = [];
let count = 1;
const target = { get id() { log.push("get at " + count); count = 100; return 7; } };
const thrower = { get id() { log.push("throws"); throw new RangeError("no id"); } };
const converter = { get id() { log.push("get"); return { toString() { log.push("converted"); return "obj"; } }; } };
function edge(n, to) { return n + "," + to.id; }
function three(n, to) { return n + "," + to.id + ";" + count; }
function fromVariable(to) { return count + ":" + to.id + ":" + count; }
function tell(f, ...rest) { try { return f(...rest); } catch (e) { return e.name; } }
for (let turn = 0; turn < 3; turn++) {
  count = turn;
  console.log(tell(edge, turn, target), tell(three, 1.5, target), tell(edge, -0, thrower), tell(edge, turn, converter), tell(edge, turn, {}), tell(edge, turn, null));
  count = turn;
  console.log(tell(fromVariable, target), log.join("; "));
  log = [];
}
