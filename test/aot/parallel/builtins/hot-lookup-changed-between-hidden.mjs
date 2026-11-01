const unknown = JSON.parse('{"f":{"b":7},"z":0,"n":1,"k":"keys","set":"set","del":"delete"}');
const T = new Map([
  ["a", 1],
  ["b", 2],
  ["c", 3],
  ["d", 4],
]);
const keys = ["a", "b", "c", "a", "zz"];
let s = 0;
for (let i = 0; i < 60000; i++) {
  const v = T.get(keys[i % 5]);
  s += v === undefined ? 0 : v;
}
const first = s;
T[unknown.set]("zz", 100);
T[unknown.del]("a");
s = 0;
for (let i = 0; i < 60000; i++) {
  const v = T.get(keys[i % 5]);
  s += v === undefined ? 0 : v;
}
console.log(first | 0, s | 0, T.size | 0);
