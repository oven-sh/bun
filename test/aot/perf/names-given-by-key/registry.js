// A registry is given twelve names by key. Its names are listed, or are not, before it is given one more, and are then listed again and again.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const registry = {};
for (let k = 0; k < 12; k++) registry["handler" + k] = k;
function list() {
  let sum = 0;
  for (const name in registry) sum += registry[name];
  return sum;
}
function keys() {
  return Object.keys(registry).length;
}
const loops = {
  "a loop over the names": [() => 0, list],
  "a loop over the names, the last of which came behind such a loop": [list, list],
  "Object.keys": [() => 0, keys],
  "Object.keys, the last of which came behind Object.keys": [keys, keys],
};
function run(name, n) {
  const [before, each] = loops[name];
  let sum = before();
  registry["late" + name.length] = 1;
  for (let i = 0; i < n; i++) sum += each();
  return sum;
}
if (which) console.log(which, run(which, rounds));
else for (const name in loops) console.log(name, run(name, rounds));
