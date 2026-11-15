// STATISTIC: TableCapacitiesReserved >= 3
// A loop reserves room for an empty collection, and other code looks at it, walks it, fills or clears it before the first entry.
const lists = JSON.parse('[[1,2,3,2,1,9,8,7],["a","b","c","d","e","f","a"],[1.5,null,"x",true,-1,2,3,4,5,6],[]]');
const log = [];
function count(list) {
  const map = new Map();
  for (const key of list) map.set(key, (map.get(key) ?? 0) + 1);
  return [...map].join(";");
}
function walked(list, look) {
  const map = new Map();
  for (const key of list) {
    look(map);
    map.set(key, key);
  }
  return [...map.keys()].join() + map.size;
}
function collected(list, look) {
  const set = new Set();
  const early = set[Symbol.iterator]();
  for (const key of list) {
    look(set);
    set.add(key);
  }
  return [...set].join() + [...early].length;
}
function stopped(list) {
  const map = new Map();
  try {
    for (const key of list) {
      if (key) throw map;
      map.set(key, 1);
    }
  } catch {}
  let seen = 0;
  for (const pair of map) seen++;
  map.set("late", 1);
  for (const pair of map) seen += 10;
  return [seen, map.size, [...map]].join();
}
let walks = 0;
const looks = [table => { for (const one of table) walks++; }, table => { walks += table.size; }, table => { if (table.size === 2) table.clear(); }, table => { table.delete("a"); table.delete(1); }, table => { if (!table.size) table instanceof Map ? table.set("first", 0) : table.add("first"); }, table => { walks += [...table].length; }];
for (const list of lists) {
  log.push(count(list), stopped(list));
  for (const look of looks) log.push(walked(list, look), collected(list, look));
}
console.log(log.join("|"), walks);
