// Counters by computed keys, kept in an object without a prototype and in a plain one
function tally(list) {
  const plain = {};
  const bare = Object.create(null);
  for (let i = 0; i < list.length; i++) {
    for (let k = 0; k <= i; k++) {
      const key = list[(i + k) % list.length];
      plain[key] = (plain[key] || 0) + 1;
      bare[key] = key in bare ? bare[key] + k : k;
    }
  }
  return Object.keys(plain).map(key => key + plain[key]).join() + " " + JSON.stringify(bare);
}
console.log(tally(["x", "y", "x"]));
console.log(tally([3, 1, 2, 1]));
console.log(tally(["constructor", "toString", "k"]).length, tally([null, undefined, true, 1.5]));
