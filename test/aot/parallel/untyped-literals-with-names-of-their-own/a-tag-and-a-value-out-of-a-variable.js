function place(base, where) {
  return (where.kind === "fixed" ? where.value : base) + "!";
}
function choose(turn) {
  const where = turn % 2 ? { kind: "fixed", value: "v" + turn } : { kind: "free", other: turn };
  return place("b", where);
}
let text = "";
for (let turn = 0; turn < 300; turn++) text = choose(turn) + choose(turn + 1);
console.log(text);
