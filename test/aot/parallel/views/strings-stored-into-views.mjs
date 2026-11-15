// STATISTIC: AccessesInsideViews >= 4
// Strings, undefined, null and booleans among the numbers that a loop stores into a view are converted without running code.

const one = Number("1");
const mixed = [1, 2.5, "7", -3, 300, "0x10", undefined, null, true, "n" + one, "1e400", -0, "4" + one];
const counts = [1, 2, "3", 255, 256, "-1"];

function bytesOf(list) {
  const bytes = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) bytes[i] = list[i];
  return bytes;
}
function clampedOf(list) {
  const bytes = new Uint8ClampedArray(list.length);
  for (let i = 0; i < list.length; i++) bytes[i] = list[i];
  return bytes;
}
function integersOf(list) {
  const integers = new Int32Array(list.length);
  for (let i = 0; i < list.length; i++) integers[i] = list[i];
  return integers;
}
function doublesOf(list) {
  const doubles = new Float64Array(list.length);
  for (let i = 0; i < list.length; i++) doubles[i] = list[i];
  return doubles;
}
// The view is shorter than the list.
function firstThree(list) {
  const integers = new Int16Array(3);
  for (let i = 0; i < list.length; i++) integers[i] = list[i];
  return integers;
}

const show = view => Array.from(view, x => (Object.is(x, -0) ? "-0" : String(x))).join(" ");
for (let round = 0; round < 4; round++) {
  for (const list of [mixed, counts]) {
    console.log(show(bytesOf(list)));
    console.log(show(clampedOf(list)));
    console.log(show(integersOf(list)));
    console.log(show(doublesOf(list)));
    console.log(show(firstThree(list)));
  }
  mixed.push("9" + round);
  counts[round] = round === 2 ? undefined : String(round);
}
