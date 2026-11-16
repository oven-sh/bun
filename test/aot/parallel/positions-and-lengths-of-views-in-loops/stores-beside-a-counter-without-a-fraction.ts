// A store outside the view does nothing.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function fill(view: Int32Array, from: number): string {
  let turns = 0;
  for (let at = Math.trunc(from); turns < 3; at += 2, turns++) {
    view[at] = 100 + turns;
    view[at + 1] = 200 + turns;
    view[at - 3] = 300 + turns;
  }
  return view.join(" ");
}
for (const from of [0, -0, -3, 0.5, -0.5, NaN, Infinity, -Infinity, 2 ** 31 - 2, 2 ** 32 - 2, 2 ** 53 - 2, -(2 ** 31) - 2, 1e300, 3.0000000001, 4, 7, 11, 12]) console.log(show(from), fill(new Int32Array(12), from));
