// STATISTIC: PropertiesKeptAsDictionaries >= 2
// Nobody knows the holders. An empty literal is a dictionary if elements are stored through the property that holds it.
function begin(holder) {
  if (!holder.last) holder.last = 0;
  if (!holder.slots) holder.slots = {};
  holder.last += 1;
  const slot = holder.last;
  holder.slots[slot] = 0;
  return slot;
}
function each(holder, callback) {
  const slot = begin(holder);
  while (holder.slots[slot] < holder.nodes.length) {
    const index = holder.slots[slot];
    if (callback(holder.nodes[index], index) === false) break;
    holder.slots[slot] += 1;
  }
  delete holder.slots[slot];
}
function insert(holder, at, node) {
  holder.nodes.splice(at, 0, node);
  for (const id in holder.slots) {
    const index = holder.slots[id];
    if (at <= index) holder.slots[id] = index + 1;
  }
}
function open(cache) {
  cache.kept = {};
  return cache;
}
function answer(cache, key, make) {
  if (key in cache.kept) return cache.kept[key];
  return (cache.kept[key] = make(key));
}
// A name is stored through this one as well.
function named(holder, key) {
  holder.both = {};
  holder.both[key] = 1;
  holder.both.length = key;
  return JSON.stringify(holder.both);
}
const holders = JSON.parse('[{ "nodes": [1, 2, 3] }, { "nodes": ["a", "b"], "name": "x" }, { "nodes": [] }]');
for (let k = 0; k < 4; k++) {
  for (const holder of holders) {
    let seen = "";
    each(holder, (node, index) => {
      seen += node + ":" + index + " ";
      if (k === 1 && index === 1 && holder.nodes.length < 6) insert(holder, 0, "n" + k);
      if (k === 2 && index === 0) each(holder, inner => { seen += "(" + inner + ")"; });
      return !(k === 3 && index === 2);
    });
    console.log(seen, holder.last, JSON.stringify(holder.slots), Object.keys(holder.slots).length);
  }
  const cache = holders[0].cache ??= open(JSON.parse('{ "kind": "cache" }'));
  const make = key => String(key) + "!" + k;
  console.log(answer(cache, "a", make), answer(cache, "toString", make) === Object.prototype.toString, answer(cache, 7, make), answer(cache, -1, make), answer(cache, 4e9, make), answer(cache, k + 0.5, make));
  console.log(JSON.stringify(cache.kept), Object.keys(cache.kept).join(), named(holders[1], k));
}
const odd = JSON.parse('{ "nodes": [1] }');
begin(odd);
const proto = ["__pro", "to__"].join("");
odd.slots[proto] = { 5: "above" };
console.log(odd.slots[5], Object.keys(odd.slots).join(), 5 in odd.slots, delete odd.slots[5], odd.slots[5]);
Object.freeze(odd.slots);
odd.slots[1] = 9;
console.log(odd.slots[1], delete odd.slots[1], JSON.stringify(odd.slots));
