// Between the step that hands out a key and the read under it the property is deleted, made an accessor, or moved to the prototype.
function walk(o, change) {
  let text = "";
  for (const k in o) {
    change(o, k);
    text += k + "=" + o[k] + (k in o ? "+" : "-") + (Object.hasOwn(o, k) ? "own " : "not ");
  }
  return text;
}
const nothing = () => {};
const deletes = (o, k) => { if (k === "b") delete o.b; };
const accessor = (o, k) => { if (k === "b") Object.defineProperty(o, "b", { get() { return "got"; }, enumerable: true, configurable: true }); };
const above = (o, k) => { if (k === "b") { delete o.b; Object.setPrototypeOf(o, { b: "above" }); } };
function deed() {
  return [walk({ a: 1, b: 2, c: 3 }, deletes), walk({ a: 1, b: 2, c: 3 }, accessor), walk({ a: 1, b: 2, c: 3 }, above)].join("| ");
}
console.log(deed());
for (let i = 0; i < 4; i++) console.log(walk({ a: 1, b: 2, c: 3 }, nothing), "#", deed());
