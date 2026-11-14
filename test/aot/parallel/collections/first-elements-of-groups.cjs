// STATISTIC: ArrayLiteralsAllocatedWithCapacity >= 3
// The first element of a group is a literal that later elements are pushed to: it has room for them.
"use strict";
function grouped(list, keyOf) {
  const groups = {};
  for (const one of list) {
    const key = keyOf(one);
    const group = groups[key];
    if (group) group.push(one);
    else groups[key] = [one];
  }
  return groups;
}
function mapped(list, keyOf) {
  const groups = new Map();
  for (const one of list) {
    const key = keyOf(one);
    const group = groups.get(key);
    if (group) group.push(one, key);
    else groups.set(key, [one]);
  }
  return groups;
}
function kept(list, table) {
  for (let k = 0; k < list.length; k++) {
    const key = list[k];
    if (table[key] === undefined) table[key] = [{ k }];
    else if (table[key].length < 5) table[key].push({ k }, k / 2);
    else table[key] = [null];
  }
  return table;
}
const show = value => Array.isArray(value) ? "[" + Array.from(value, show) + "]" : typeof value === "object" && value ? "o" : Object.is(value, -0) ? "-0" : String(value);
const lists = [[1, 2, 3, 4, 5, 6, 7], ["a", "b", "a", "c", "a", "a", "a", "a"], [1.5, "x", null, undefined, {}, 1.5, -0, NaN, 2n], Array.from({ length: 60 }, (_, k) => (k % 3 ? k : k / 2)), []];
const keys = [one => typeof one, one => String(one).length, one => "same", one => one];
for (const list of lists) {
  for (const keyOf of keys) {
    let groups;
    try { groups = grouped(list, one => String(keyOf(one))); } catch (error) { console.log(error.constructor.name); continue; }
    console.log(Object.entries(groups).map(([key, group]) => key + group.length + show(group)).join(" "));
    console.log([...mapped(list, keyOf)].map(([key, group]) => show(key) + group.length + show(group)).join(" "));
    for (const group of Object.values(groups)) {
      group.length = 2;
      group[4] = "later";
      console.log(show(group), 3 in group, group.length, group.indexOf(undefined), JSON.stringify(group.concat([]).length));
    }
  }
  console.log(Object.entries(kept(list.map(String), {})).map(([key, group]) => key + show(group)).join(" "));
}
// What the room holds stays empty for every reader.
const single = grouped([7], String)[7];
console.log(single.length, 1 in single, single[1], Object.keys(single).join(), single.at(-1), [...single].length, single.pop(), single.length, single.push(1, 2, 3, 4, 5), show(single));
Object.setPrototypeOf(single, { __proto__: Array.prototype, 9: "above" });
single.length = 12;
console.log(single[9], show(single));
