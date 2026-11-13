// Objects are given names by key while the names are new. They are then read by name, or give names up and are given them again.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const fields = ["inner", "flag", "value", "next"];
function record() {
  const object = JSON.parse("{}");
  for (const name of fields) object[name] = 3;
  return object;
}
const first = record();
const second = record();
function read(object, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) if (object.flag) sum += object.value;
  return sum;
}

const keys = Object.keys(Object.fromEntries(Array.from({ length: 16 }, (_, k) => ["session" + k, 0])));
const worn = JSON.parse("{}");
for (let k = 0; k < 200; k++) {
  worn.gone = k;
  delete worn.gone;
}
function comeAndGo(object, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const key = keys[i & 15];
    object[key] = i & 7;
    delete object[keys[(i + 8) & 15]];
    sum += object[key];
  }
  return sum;
}
const loops = {
  "reads by name of the second object that was given the names": n => read(second, n),
  "reads by name of the first object that was given the names": n => read(first, n),
  "names come and go on an object that has given many up": n => comeAndGo(worn, n),
  "names come and go on a new object": n => comeAndGo(JSON.parse("{}"), n),
};
if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds));
