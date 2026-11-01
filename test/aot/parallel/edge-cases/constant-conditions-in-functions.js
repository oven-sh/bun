// The same conditions inside functions, methods and arrows, whose text an executable keeps for toString() and for what errors quote.
const on = true;
const off = false;
function call(value) {
  return value;
}
function inAFunction() {
  const inner = true;
  const text = inner ? "kept" : "dropped";
  const outer = on ? "kept" : "dropped";
  const both = inner ? (off ? "a" : "b") : "c";
  return [text, outer, both, off ? call("dropped") : call("kept")];
}
class Holder {
  method() {
    const flag = false;
    const value = flag ? "dropped" : "kept";
    return value;
  }
  static field = on ? "kept" : "dropped";
}
const arrow = () => {
  const flag = true;
  const value = flag ? `kept ${1}` : `dropped ${2}`;
  return value;
};
console.log(inAFunction(), new Holder().method(), Holder.field, arrow());
function throws(o) {
  const flag = false;
  const chosen = flag ? o.dropped : o.kept;
  return chosen.a.b;
}
try {
  throws({ kept: {} });
} catch (error) {
  console.log(error.message);
}
function throwsInTheArm(o) {
  const flag = true;
  return flag ? o.a.b.c : o.d;
}
try {
  throwsInTheArm({ a: {} });
} catch (error) {
  console.log(error.message);
}
