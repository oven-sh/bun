// Pairs taken apart by loops, with defaults and rests
function walk(pairs) {
  const keys = [];
  let [low, high] = [Infinity, -Infinity];
  for (const [key, value = keys.length, ...rest] of pairs) {
    keys.push(key);
    for (const { x, y = x } of rest) keys.push(x + y);
    [low, high] = [value < low ? value : low, value > high ? value : high];
  }
  return keys.join() + " " + low + ".." + high;
}
console.log(walk([["a", 5], ["b", 2], ["c"]]));
console.log(walk([["d", 1.5, { x: 1 }, { x: 2, y: 3 }], ["e", undefined, { x: "p" }]]));
console.log(walk([]), walk([[null, null], [, "9"]]));
