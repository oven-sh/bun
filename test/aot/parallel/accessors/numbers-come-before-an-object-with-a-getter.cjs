// A variable holds a number and later an object. A loop reads a name off it, under which a getter is defined at last.
let held = 0;
const kinds = { FIRST: 1, SECOND: 2 };
function count(list) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === held.FIRST) n++;
  }
  return n;
}
function kindsOf(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) {
    switch (list[i]) {
      case held.FIRST: text += "f"; break;
      case held.SECOND: text += "s"; break;
      default: text += "-";
    }
  }
  return text;
}
const list = JSON.parse("[1,2,1,0,null]");
list.push(undefined);
console.log(count(list), kindsOf(list));
held++;
console.log(count(list), kindsOf(list));
held = kinds;
console.log(count(list), kindsOf(list));
let calls = 0;
Object.defineProperty(kinds, "FIRST", { get() { calls++; return 2; }, configurable: true });
console.log(count(list), kindsOf(list), calls);
held = 7;
console.log(count(list), kindsOf(list), calls);
held = kinds;
Object.defineProperty(kinds, "SECOND", { get() { throw new RangeError("second"); } });
try { kindsOf(list); } catch (error) { console.log(error.name, calls); }
