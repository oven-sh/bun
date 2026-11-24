// STATISTIC: CopiedBinarySearchesVersioned >= 1
// A binary search that calls its parameters is copied into its callers: the copy tests its bounds before the loop too.
// The gates of a road stand at rising miles. A search asks `passed` how far a gate lies behind the traveler, and is copied into the functions that hand it theirs.
function gateBehind(passed, gates, from, to) {
  let near = from, far = to, left = 80;
  while (near <= far) {
    if (left-- === 0) return "endless " + near + " " + far;
    const middle = near + ((far - near) >> 1), behind = passed(gates[middle]);
    if (behind > 0) near = middle + 1;
    else if (behind < 0) far = middle - 1;
    else return "at " + middle;
  }
  return "behind " + far;
}
function stretchOf(miles, at, from = 0) {
  return gateBehind(mile => at - mile, miles, from, miles.length - 1);
}
function tollOf(tolls, at, from = 0) {
  return gateBehind(toll => (toll ? at - toll.mile : 1), tolls, from, tolls.length - 1);
}
const miles = [];
for (let i = 0, at = 0; i < 50; i++) {
  miles.push(at);
  at += (i * 7) % 13 + 1;
}
const tolls = miles.map(mile => ({ mile }));
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const attempt = f => { try { return show(f()); } catch (error) { return error.constructor.name; } };
const froms = [undefined, 0, 7, 49, 50, null, -1, 0.5, 1.5, NaN, -0, "1", "x", 2147483647, 1073741823, 1073741824, -1073741825, -2147483648, 1e10, Infinity, -Infinity, true];
for (const from of froms) {
  const line = [show(from)];
  for (let at = -3; at < 330; at += from === undefined || from === 0 ? 1 : 37) line.push(attempt(() => stretchOf(miles, at, from)), attempt(() => tollOf(tolls, at, from)));
  console.log(line.join(" "));
}
for (const list of [[], undefined, [5], ["a", "b", "c"], [0.5, 1.5, 2.5], [, 1, , 9], new Int32Array([1, 4, 9, 16])]) {
  console.log([0, 1, 2.5, "b", undefined, NaN].map(at => attempt(() => stretchOf(list, at))).join(" "));
}
let seen = 0;
console.log(attempt(() => gateBehind(mile => { if (++seen === 3) miles.length = 20; return 100 - mile; }, miles, 0, miles.length - 1)), seen, miles.length);
console.log(attempt(() => gateBehind(toll => 100 - toll.mile, tolls, 0, 12)));
