// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceGeneric <= 0
// COUNT: operation:operationAOTArraySpliceItemGeneric <= 0
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const roomy = (...items) => { const list = Array.from(items); list.push(items[0]); list.pop(); return list; };
for (let turn = 0; turn < 4; turn++)
  for (const at of [-1, -2, -3, -4, -5, -2147483648]) {
    const gone = roomy("a", "b", "c", "d"), grown = roomy("a", "b", "c", "d");
    go(OUT, gone, at);
    go(INTO, grown, at, "new");
    console.log("SAID", at, JSON.stringify(gone), JSON.stringify(grown));
  }
