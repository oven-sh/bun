// Nothing cuts the counter, so it is a number. It has no fraction.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function sum(view: Int32Array, bound: unknown): number {
  let total = 0;
  for (let at = 0; at < (bound as number); at += 5) total = (Math.imul(total, 31) + (view[at]! ^ view[at + 2]! ^ view[at - 1]! ^ view[at - 4]!)) | 0;
  return total;
}
function down(view: Int32Array, bound: unknown): number {
  let total = 0;
  for (let at = 14; at > (bound as number); at -= 3) total = (Math.imul(total, 31) + (view[at]! ^ view[at + 2]! ^ view[at - 1]!)) | 0;
  return total;
}
function far(view: Int32Array, bound: unknown): string {
  let found = "";
  for (let at = 1; at < (bound as number); at *= 4096) found += show(view[at]) + show(view[at - 1]) + show(view[at + 1]) + " ";
  return found;
}
const view = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
for (const bound of [0, 1, 12, 13, 40, 12.5, -7, "12", NaN, undefined, null, { valueOf: () => 11 }]) console.log(sum(view, bound), down(view, bound));
for (const bound of [0, 2, 1e9, 1e18, 1e40, Infinity]) console.log(far(view, bound).length, far(view, bound).slice(0, 60));
