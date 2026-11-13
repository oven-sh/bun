function oddKeyInMap() { return new Map([["k", { "-1": "unknown", name: "x" }], ["l", { first: 1, "1.5": 2, name: "y", 7: "seven", last: [1, { "-2": 1, a: 2 }] }]]); }
function oddKeyInSet() { return new Set([{ 1.5: "half", name: "x" }, { name: "z", "-1": 0, size: 3 }]); }
function namesInMap() { return new Map([["k", { name: "x", size: 2 }]]); }
function tell(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
for (let turn = 0; turn < 3; turn++) {
  const map = oddKeyInMap(), set = oddKeyInSet(), plain = namesInMap();
  for (const [key, value] of map) console.log(key, tell(value), value.name, value["-1"], value["1.5"]);
  for (const value of set) console.log(tell(value), value.name, value.size);
  for (const [key, value] of plain) console.log(key, tell(value));
  const one = map.get("k"); one.name = turn; one.added = 1; delete one["-1"]; console.log(tell(one), map.get("k") === one, oddKeyInMap().get("k") === one, tell(oddKeyInMap().get("k")));
  const other = map.get("l"); other.last[1].a = turn; console.log(tell(other), tell(oddKeyInMap().get("l")));
}
