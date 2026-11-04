// Object.is under its own name, under another name, and a local named Object: NaN is itself, the two zeroes differ, and an integer on one side does not make it ===
const is = Object.is;

function same(a, b) {
  return Object.is(a, b);
}
function sameInteger(a, b) {
  return Object.is(a | 0, b);
}
function sameText(a, b) {
  return typeof a === "string" ? Object.is(a, b) : "no text";
}
function sameItself(a) {
  return is(a, a);
}
function otherObject(a, b) {
  const Object = { is: () => "a local" };
  return Object.is(a, b);
}

function deed(turn) {
  const hostile = [NaN, -0, 0, "0", null, undefined];
  const a = hostile[turn % 6];
  const b = hostile[(turn >> 1) % 6];
  return String(same(a, b)) + sameInteger(a, b) + sameText(a, b) + sameItself(a);
}

console.log(same(1, 1), same(1, 2), sameInteger(1, 1), sameText("a", "a"), sameItself({}), otherObject(1, 1));
let seen = "";
for (let i = 0; i < 300; i++) seen = String(same(i, i)) + sameInteger(i, i) + sameText("" + i, "" + i);
console.log(seen);
console.log(same(NaN, NaN), same(0, -0), same(-0, -0), sameInteger(0, -0), sameInteger(-0, 0), sameItself(NaN), sameItself(-0));
for (let i = 0; i < 12; i++) console.log(deed(i));
