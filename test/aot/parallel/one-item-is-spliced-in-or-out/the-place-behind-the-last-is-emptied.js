// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceOfAnyList <= 0
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const roomy = (...items) => { const list = Array.from(items); list.push(items[0]); list.pop(); return list; };
for (let turn = 0; turn < 4; turn++)
  for (const at of [0, 1, 2, -1]) {
    const list = roomy({ n: 1 }, { n: 2 }, { n: 3 });
    go(OUT, list, at);
    list.length = 3;
    console.log("SAID", at, 2 in list, String(list[2]), JSON.stringify(list));
  }
