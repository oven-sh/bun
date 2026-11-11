// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceGeneric <= 2
// COUNT: operation:operationAOTArraySpliceItemGeneric <= 2
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const roomy = (...items) => { const list = Array.from(items); list.push(items[0]); list.pop(); return list; };
for (let turn = 0; turn < 4; turn++) {
  const list = roomy(1, 2, 3);
  if (turn >= 2) list.constructor = { [Symbol.species]: function (length) { console.log("SAID the species is asked for", length); return []; } };
  go(OUT, list, 1);
  go(INTO, list, 1, 9);
  console.log("SAID", turn, JSON.stringify(list));
}
