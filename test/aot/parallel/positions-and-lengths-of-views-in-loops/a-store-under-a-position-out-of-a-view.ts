// `outer[inner[at]] = at`: past the end of `inner` the store lays a property named "undefined".
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function fill(outer: Int32Array, inner: Int32Array, turns: number): void {
  for (let at = 0; at < turns; at++) outer[inner[at]!] = at + 1;
}
const outer = new Int32Array(4);
const inner = Int32Array.from([2, 0, 9, -1, 3]);
fill(outer, inner, 5);
console.log(outer.join(" "), show((outer as any).undefined), Object.keys(outer).join(","));
fill(outer, inner, 8);
console.log(outer.join(" "), show((outer as any).undefined), Object.keys(outer).join(","));
