const set = new Set([1, 2, 3]);
const map = new Map([["a", 1]]);
const list = [1, 2, 3];
function all() {
  let t = "";
  for (const v of set) t += v;
  for (const [k, v] of map) t += k + v;
  for (const v of list) t += v;
  const [x, ...r] = list;
  return t + x + r.length + [...set].length + Math.max(...list);
}
console.log(all());
set[Symbol.iterator] = function* () {
  yield "own";
};
map.get = () => "got";
map[Symbol.iterator] = () => [["z", 9]][Symbol.iterator]();
list[Symbol.iterator] = function* () {
  yield 7;
  yield 8;
};
console.log(all(), map.get("a"));
delete set[Symbol.iterator];
list.length = 1;
console.log(all());
