// STATISTIC: CarriedKeysTaggedByWidth >= 2
// Nobody knows the elements. The columns of these tables have either width, and some change while the loop steps them.
const sets = JSON.parse('[[1,2,3],["a","b","c"],[null,true,false],[1.5,"x",null,7],[]]').map(list => new Set(list));
const show = x => (typeof x === "string" ? x : String(x));
function join(set) {
  let made = "", count = 0;
  for (const x of set) {
    made += show(x) + ",";
    count++;
  }
  return made + count;
}
function change(set, step) {
  let made = "", turn = 0;
  for (const x of set) {
    made += show(x) + ";";
    if (turn++ === step) {
      set.delete(x);
      set.add("late").add(17).add(null);
    } else if (turn === 5) {
      set.clear();
      set.add(turn).add("again");
    }
    if (turn > 12) break;
  }
  return made;
}
function pairs(map) {
  let made = "";
  for (let k = 0; k < 2; k++) {
    for (const [key, value] of map) made += show(key) + show(value) + ",";
    for (const key of map.keys()) for (const value of map.values()) made += show(key) + show(value);
  }
  return made;
}
for (const set of sets) console.log(join(set), join(set), change(set, 1), change(set, 0), join(set));
const maps = JSON.parse('[[[1,2],[3,4]],[["a",1],["b",2]],[[1,"a"],["b",2],[null,true]]]').map(list => new Map(list));
for (const map of maps) {
  console.log(pairs(map));
  map.set("k", 9).set(1.25, "v");
  console.log(pairs(map));
}
