// The view is not extensible: in strict code the store under "undefined" throws, in the middle of the loop.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function fill(outer: Int32Array, inner: Int32Array, turns: number): string {
  let at = 0;
  try {
    for (; at < turns; at++) outer[inner[at]!] = at + 1;
  } catch (error) {
    return at + " " + (error as Error).name;
  }
  return at + " done";
}
const outer = new Int32Array(4);
const inner = Int32Array.from([2, 0, 9, -1, 3]);
Object.preventExtensions(outer);
console.log(fill(outer, inner, 5), outer.join(" "));
console.log(fill(outer, inner, 8), outer.join(" "));
