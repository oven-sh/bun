// `[...list]` and Array.from(list) of a parsed list of fractions, of every length up to 40: each element arrives at its own place, and a hole at the start, in the middle or at the end arrives as undefined.
function parsed(length: number): number[] {
  return JSON.parse("[" + Array.from({ length }, (_, k) => k + 0.25).join() + "]");
}
function spread(list: number[]): unknown[] {
  return [...list];
}
function from(list: number[]): unknown[] {
  return Array.from(list);
}
function show(list: unknown[]): string {
  let text = "";
  for (let k = 0; k < list.length; k++) text += (k in list ? String(list[k]) : "hole") + " ";
  return text + "(" + list.length + ")";
}
for (let length = 0; length <= 40; length++) {
  const whole = parsed(length);
  console.log(show(spread(whole)), "|", show(from(whole)));
  for (const at of [0, length >> 1, length - 1]) {
    if (at < 0 || at >= length) continue;
    const holed = parsed(length);
    delete holed[at];
    const copy = spread(holed);
    copy.push("end");
    console.log(length, at, show(copy), "|", show(from(holed)), "|", show(holed));
  }
}
const special: number[] = JSON.parse("[-0, 1e308, 5e-324, -1.5, 4294967296.5, 0.1]");
console.log(show(spread(special)), Object.is(spread(special)[0], -0), Object.is(from(special)[0], -0));
