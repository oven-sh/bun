const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
const log = [];
const desk = { leftValue: 1, rightValue: 2,
  get left() { log.push("get left"); return this.leftValue; }, set left(v) { log.push("set left " + v); this.leftValue = v; },
  get right() { log.push("get right"); return this.rightValue; }, set right(v) { log.push("set right " + v); this.rightValue = v; } };
function swapMembers(o, tools, at) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const first = o.right + tools.round(at), second = o.left;
  o.left = first; o.right = second;
  return o.leftValue + ":" + o.rightValue + ":" + work;
}
function reverse(list, tools) {
  for (let i = 0, j = list.length - 1; i < j; i++, j--) {
    const first = list[j], second = tools.round(list[i] + 0.5);
    list[i] = first; list[j] = second;
  }
  return list.join(",");
}
function chained(o, tools, at) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const a = tools.round(at + 0.5);
  o[a] = "first"; o[a + 1] = "second";
  return a + ":" + Object.keys(o).join(",") + ":" + work;
}
let out = "";
for (let round = 0; round < 300; round++) {
  log.length = 0; desk.leftValue = 1; desk.rightValue = 2;
  out = [swapMembers(desk, kit, 10.5), log.join("|"), reverse([1, 2, 3, 4, 5], kit), chained({}, kit, 3)].join(" / ");
}
console.log(out);
