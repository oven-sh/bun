function listOf(steps, change) {
  const list = [];
  for (const step of steps) list.push(change ? change(step) : step);
  return list;
}
function pairsOf(steps) {
  let text = "";
  for (const [key, value] of steps) text += key + "=" + value + ";";
  return text;
}
function firstOf(steps) {
  for (const step of steps) return step;
  return "none";
}
function run(turns) {
  const said = [];
  for (let turn = 0; turn < turns; turn++) {
    const table = new Map([["a" + turn, turn], ["b", turn + 1], [turn, "c"]]);
    const members = new Set([turn, "x", turn + 0.5]);
    said.push(listOf(table.values()).join(), listOf(table.keys()).join(), listOf(table.entries(), pair => pair.join(":")).join());
    said.push(listOf(members.values()).join(), listOf(members.keys(), member => member + "!").join(), listOf(members.entries()).join("|"));
    said.push(pairsOf(table.entries()), pairsOf(members.entries()), firstOf(table.values()), firstOf(new Map().keys()), firstOf(members.values()));
    said.push(listOf(table[Symbol.iterator]()).join("/"), listOf(members[Symbol.iterator]()).join("/"));
  }
  return said.join("\n");
}
globalThis.kept = [listOf, pairsOf, firstOf];
console.log(run(3));
console.log(listOf([1, 2, 3]).join(), listOf("ab").join(), pairsOf([[1, 2]]), firstOf("z"));
