// STATISTIC: ArrayLiteralsAllocatedForLoops >= 1
// STATISTIC: IndexedStoresCompiledAsAppends >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
// Under: --aot-testing=FailSpeculations: every guess of the typed copy fails once and the turn begins again as it is written
'use strict';
const show = (list) => { let text = list.length + ":"; for (let i = 0; i < list.length; i++) text += (i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] + " " + String(list[i])) : "_") + ","; return text; };
function asGiven(first, given, other) {
  const kept = [first];
  for (let j = 1; j <= 12; j++) {
    let least = given[j] + 1;
    const beside = other[j] * 2;
    if (beside < least) least = beside;
    kept[j] = least;
  }
  return show(kept);
}
function lesser(first, given, other) {
  const kept = [first | 0];
  for (let j = 1; j <= 12; j++) {
    let least = given[j] + 1;
    const beside = other[j] * 2;
    if (beside < least) least = beside;
    kept[j] = least;
  }
  return show(kept);
}
const rounds = +process.argv[2] || 3;
const whole = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12]"), parts = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5]");
const lists = () => [whole, parts,
  [0, 1, 2, NaN, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, NaN], [0, NaN, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  [0, 1, 2, 3, "four", 5, 6, 7, 8, 9, 10, 11, 12], [0, "1", 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 1, 2, 3, 4, 5, , 7, 8, 9, 10, 11, 12],
  [0, 1, 2, 3, 4, 5, null, 7, undefined, 9, 10, 11, 12], [0, -1, -0, 1e308, -1e308, 2147483647, -2147483648, 4294967295, 9007199254740991, 1e-320, 10, 11, 12],
  [0, 1, 2, { valueOf() { return 40; } }, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 1n, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], new Float64Array(13), new Int8Array(13).fill(-3), [], "0123456789abc"];
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  for (const given of lists()) for (const other of [whole, parts, given]) for (const first of [t, 0.5, -0, NaN]) {
    for (const way of [lesser, asGiven]) {
      let line; try { line = way(first, given, other); } catch (error) { line = "threw " + error.constructor.name; }
      all += line + "\n";
    }
  }
}
console.log(all);
