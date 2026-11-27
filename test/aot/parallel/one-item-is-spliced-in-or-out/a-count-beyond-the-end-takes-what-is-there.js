// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
const [OUT, INTO] = JSON.parse('["out","into"]');
const roomy = (...items) => { const list = Array.from(items); list.push(items[0]); list.pop(); return list; };
const wide = { many(list, at) { list.splice(at, 99); }, two(list, at) { list.splice(at, 2); }, none(list, at) { list.splice(at, 0); }, below(list, at) { list.splice(at, -1); }, swap(list, at, item) { list.splice(at, 1, item); } };
const reach = (door, ...rest) => wide[door](...rest);
for (let turn = 0; turn < 4; turn++)
  for (const door of JSON.parse(JSON.stringify(Object.keys(wide))))
    for (const at of [0, 2, 3, 4]) {
      const list = roomy("a", "b", "c", "d");
      reach(door, list, at, "new");
      console.log("SAID", door, at, JSON.stringify(list), list.length);
    }
