// Where the caller of a getter stands, for updates under keys whose parts live in registers or not.
const moduleKey = "x";
function frames(error) { return error.stack.split("\n").slice(1, 3).map(line => line.replace(/^.*?([a-zA-Z<>.]+) \(.*:(\d+:\d+)\)$/, "$1@$2").replace(/^.*:(\d+:\d+)$/, "@$1")).join(" "); }
const holder = () => ({ get x() { throw new Error("getter"); }, set x(v) {} });
function both(o, k) { o[k]++; }
function sum(o, k) { o[k] += 1; }
function logical(o, k) { o[k] ??= 1; }
function moduleVariable(o) { o[moduleKey + ""]++; }
function afterCall(o, k) { String(k); o[k]++; }
function onNextLine(o, k) {
  o
    [k]++;
}
for (const f of [both, sum, logical, moduleVariable, afterCall, onNextLine]) {
  try { f(holder(), "x"); } catch (error) { console.log(f.name, "getter", frames(error)); }
  try { f(undefined, "x"); } catch (error) { console.log(f.name, "nothing", error.message, frames(error)); }
}
