// What a member of the operand returns may hold the operand, or the member may keep it.
function otherJoin() {
  return Array.prototype.toString.call({ join() { return "x"; } });
}
function otherExec() {
  return RegExp.prototype[Symbol.match].call({ exec() { return null; }, flags: "" }, "a");
}
function viaJoin() {
  const made = { count: () => 1, join() { return { self: this }; }, label: "two" };
  const again = Array.prototype.toString.call(made);
  Reflect.set(again.self, "count", 4);
  return [typeof made.count, again.self === made].join(" ");
}
function viaExec() {
  const made = { count: () => 1, exec() { return [this]; }, flags: "", label: "two" };
  const again = RegExp.prototype[Symbol.match].call(made, "a");
  delete again[0].count;
  return [typeof made.count, again[0] === made].join(" ");
}
function viaStored() {
  const kept = [];
  const made = { count: () => 1, join() { kept.push(this); return "x"; }, label: "two" };
  Array.prototype.toString.call(made);
  Object.freeze(kept[0]);
  try { made.label = "three"; } catch {}
  return made.label;
}
if (process.argv.length > 5) console.log(otherJoin(), otherExec());
for (let turn = 0; turn < 3; turn++) console.log(viaJoin(), viaExec(), viaStored());
