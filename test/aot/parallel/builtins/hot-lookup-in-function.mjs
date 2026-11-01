const unknown = JSON.parse('{"f":{"b":7},"z":0,"n":1,"k":"keys","set":"set","del":"delete"}');
const T = new Map([
  ["a", 1],
  ["b", 2],
  ["c", 3],
  ["d", 4],
]);
const keys = ["a", "b", "c", "a", "zz"];
function sum(M, names) {
  let s = 0;
  for (let i = 0; i < 60000; i++) {
    const v = M.get(names[i % 5]);
    s += v === undefined ? 0 : v;
  }
  return s;
}
const one = sum(T, keys);
T.set("zz", 7);
const two = sum(T, keys);
T.delete("a");
const three = sum(T, keys);
console.log(one | 0, two | 0, three | 0);
