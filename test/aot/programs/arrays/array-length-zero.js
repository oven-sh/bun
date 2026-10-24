const lines = [];
function show(name, list) {
  const parts = [];
  for (let i = 0; i < list.length + 2; i++) parts.push(i in list ? String(list[i]) : "-");
  lines.push(name + ": " + list.length + " [" + parts.join() + "]");
}
function sumBelowLength(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function emptiedAndFilledAgain() {
  const list = [1, 2, 3];
  list.length = 0;
  list.push(4, 5);
  show("emptiedAndFilledAgain", list);
  return sumBelowLength(list);
}
function emptiedThenReadAtOldIndex() {
  const list = [1, 2, 3];
  const at = list.length - 1;
  list.length = 0;
  return String(list[at]) + String(list[0]);
}
function emptiedBetweenTestAndStore(position) {
  const list = [1, 2, 3];
  if (position < list.length) {
    list.length = 0;
    list[position] = 9;
  }
  show("emptiedBetweenTestAndStore", list);
  return String(list[0]);
}
function emptiedByCalleeBetweenTestAndStore(position) {
  const list = [1, 2, 3];
  if (position < list.length) {
    clear(list);
    list[position] = 9;
  }
  show("emptiedByCalleeBetweenTestAndStore", list);
  return String(list[1]);
}
function clear(list) { list.length = 0; }
function emptiedInALoopOverIt() {
  const list = [1, 2, 3, 4];
  let seen = "";
  for (let i = 0; i < list.length; i++) {
    seen += list[i];
    if (i === 1) list.length = 0;
  }
  return seen;
}
function emptiedWhileACallbackGoesOverIt() {
  const list = [1, 2, 3, 4];
  const seen = list.map(value => { list.length = 0; return value * 2; });
  show("emptiedWhileACallbackGoesOverIt", seen);
  return seen.length;
}
function emptiedWhileItIsCopied() {
  const list = [1, 2, 3, 4];
  const copy = list.slice(0, { valueOf() { list.length = 0; return 4; } });
  show("emptiedWhileItIsCopied", copy);
  return String(copy[3]);
}
function emptiedThenLengthened() {
  const list = [1, 2, 3];
  list.length = 0;
  list.length = 2;
  show("emptiedThenLengthened", list);
  return String(list[1]);
}
function zeroThatIsComputed(zero) {
  const list = [1, 2, 3];
  list.length = zero;
  show("zeroThatIsComputed " + zero, list);
  return String(list[2]);
}
function otherZeros() {
  const a = [1, 2]; a.length = -0; show("minus zero", a);
  const b = [1, 2]; b.length = "0"; show("text", b);
  const c = [1, 2]; c.length = false; show("false", c);
  const d = [1, 2]; d.length = null; show("null", d);
  const e = [1, 2]; try { e.length = undefined; } catch (error) { lines.push("undefined: " + error.constructor.name); } show("undefined", e);
}
function fractionsThenIntegers() {
  const list = [1.5, 2.5];
  list.length = 0;
  list.push(1, 2);
  show("fractionsThenIntegers", list);
  return sumBelowLength(list);
}
function integersThenFractionsThenObjects() {
  const list = [1, 2];
  list.length = 0;
  list.push(0.5);
  const first = sumBelowLength(list);
  list.length = 0;
  list.push({ toString() { return "object"; } });
  show("integersThenFractionsThenObjects", list);
  return first;
}
function frozen() {
  "use strict";
  const list = Object.freeze([1, 2]);
  try { list.length = 0; } catch (error) { lines.push("frozen: " + error.constructor.name); }
  show("frozen", list);
}
function lengthThatCannotBeWritten() {
  "use strict";
  const list = [1, 2];
  Object.defineProperty(list, "length", { writable: false });
  try { list.length = 0; } catch (error) { lines.push("lengthThatCannotBeWritten: " + error.constructor.name); }
  show("lengthThatCannotBeWritten", list);
}
function elementThatCannotBeDeleted() {
  "use strict";
  const list = [1, 2, 3];
  Object.defineProperty(list, 1, { configurable: false });
  try { list.length = 0; } catch (error) { lines.push("elementThatCannotBeDeleted: " + error.constructor.name); }
  show("elementThatCannotBeDeleted", list);
}
function whatIsNoList() {
  const like = { length: 2, 0: "a", 1: "b" };
  like.length = 0;
  return like[0] + like[1] + like.length;
}
function constantList() {
  const make = () => [1, 2, 3];
  const first = make();
  first.length = 0;
  first.push(7);
  show("constantList", make());
  return first[0];
}
function manyElements() {
  const list = [];
  for (let i = 0; i < 300; i++) list.push(i);
  list.length = 0;
  for (let i = 0; i < 3; i++) list.push(i);
  show("manyElements", list);
  return sumBelowLength(list);
}

lines.push(String(emptiedAndFilledAgain()), emptiedThenReadAtOldIndex(), emptiedBetweenTestAndStore(2), emptiedByCalleeBetweenTestAndStore(2), emptiedInALoopOverIt());
lines.push(String(emptiedWhileACallbackGoesOverIt()), emptiedWhileItIsCopied(), emptiedThenLengthened(), zeroThatIsComputed(0), zeroThatIsComputed(5));
otherZeros();
lines.push(String(fractionsThenIntegers()), String(integersThenFractionsThenObjects()));
frozen(); lengthThatCannotBeWritten(); elementThatCannotBeDeleted();
lines.push(whatIsNoList(), String(constantList()), String(manyElements()));
console.log(lines.join("\n"));
