// `target(...list)`: the arguments are what the list holds. The lists come out of JSON.parse and the callee is found by name, so the compiler knows neither.
// The first loop spreads arrays that nothing has changed, of every kind of storage: no copy is made for the calls. Then come lists whose iteration is their own.
// COUNT: allCells <= 30000
const data = JSON.parse(
  '{"ints":[1,2,3],"halves":[0.5,1.5,2.5],"texts":["a","b","c"],"none":[],"many":[1,2,3,4,5,6,7,8,9,10,11,12]}',
);
const targets = {
  three(a, b, c) {
    return (a ? 1 : 0) + (b ? 2 : 0) + (c ? 4 : 0);
  },
  count() {
    return arguments.length;
  },
  last(...all) {
    return all.length ? all[all.length - 1] : "nothing";
  },
};
const names = Object.keys(targets);
const lists = [data.ints, data.halves, data.texts, data.none, data.many];
let text = "";
let sum = 0;
for (let i = 0; i < 60000; i++) sum += targets[names[i % 2]](...lists[i % lists.length]);
const holed = [1, , 3];
const changed = [1, 2, 3];
changed[Symbol.iterator] = function* () {
  yield "own";
  yield "iterator";
};
class Twice extends Array {
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) {
      yield this[i];
      yield this[i];
    }
  }
}
const growing = [1, 2];
const others = [holed, changed, Twice.from([7, 8]), new Set([4, 5, 6]), "xyz", new Map([[1, 2]]).keys(), growing];
for (const name of names) for (const other of others) text += targets[name](...other) + ";";
function grow(a, b, c) {
  growing.push(a);
  return [a, b, c].join();
}
text += grow(...growing) + ";" + grow(...growing) + ";" + growing.join();
for (const bad of [undefined, null, 5, {}]) {
  try {
    targets.count(...bad);
  } catch (error) {
    text += ";" + error.constructor.name;
  }
}
console.log(sum, text);
