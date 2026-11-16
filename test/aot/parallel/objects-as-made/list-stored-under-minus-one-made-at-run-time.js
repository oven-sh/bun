// A number that is no index, made at run time, adds a NAME to a list: keys, spread, for-in, JSON and length must all see it.
function store(list, wanted, value) { list[list.indexOf(wanted)] = value; return list; }
for (const wanted of [9, 1]) {
  const a = store([1, 2], wanted, 7);
  const names = []; for (const k in a) names.push(k);
  console.log(Object.keys(a).join(), JSON.stringify({ ...a }), names.join(), a.length, JSON.stringify(a), Object.getOwnPropertyNames(a).join(), "-1" in a, a[-1]);
}
function storeBy(list, key) { list[key] = "x"; return Object.keys(list).join(); }
const zero = process.argv.length > 9 ? 1 : 0;
console.log(storeBy([1], zero / zero), storeBy([1], 1 / zero), storeBy([1], 1.5 + zero), storeBy([1], 4294967295 + zero), storeBy([1], -zero), storeBy([1], 1 + zero));
