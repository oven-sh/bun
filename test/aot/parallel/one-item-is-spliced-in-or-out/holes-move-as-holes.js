// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceOfAnyList <= 8
// COUNT: operation:operationAOTArraySpliceItemIntoAnyList <= 4
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const shown = list => Array.from({ length: list.length }, (_, i) => (i in list ? String(list[i]) : "hole")).join(",");
for (let turn = 0; turn < 4; turn++) {
  for (const at of [0, 1, 2, 4]) {
    const list = [1, , 3, , 5]; list.push(0); list.pop();
    go(OUT, list, at);
    console.log("SAID out", at, shown(list), list.length);
  }
  for (const at of [0, 1, 2, 5]) {
    const list = ["a", , "c", , "e"];
    list.push(0); list.pop();
    go(INTO, list, at, "new");
    console.log("SAID in", at, shown(list), list.length);
  }
  for (const door of [OUT, INTO]) {
    const long = Array.from({ length: 44 }, (_, i) => "t" + i);
    delete long[5]; delete long[20]; delete long[43];
    long.push(0); long.pop();
    go(door, long, 1, "new");
    console.log("SAID long", door, shown(long), long.length);
  }
}
