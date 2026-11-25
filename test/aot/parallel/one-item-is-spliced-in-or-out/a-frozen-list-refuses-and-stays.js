// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const roomy = (...items) => { const list = Array.from(items); list.push(items[0]); list.pop(); return list; };
for (let turn = 0; turn < 4; turn++) {
  const list = Object.freeze(roomy({ n: 1 }, { n: 2 }, { n: 3 }));
  for (const door of [OUT, INTO]) {
    try { go(door, list, 1, { n: 9 }); console.log("SAID nothing was thrown"); } catch (error) { console.log("SAID", door, error.name); }
    console.log("SAID", turn, JSON.stringify(list), list.length, Object.isFrozen(list));
  }
}
