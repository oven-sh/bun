// Two values are compared, and compared again with the operands the other way round: in an `if`, negated, in a ternary, behind `&&` and `||`, in a `switch`, in the test of a loop.
// Behind the second comparison each arm goes on with the variable that the text names, whichever the first comparison named first.
function returnsEarly(f) {
  const e = undefined;
  let a = 0;
  if (e === f) a = 1;
  if (f === e) return a + ":none";
  return a + ":" + (f + 1);
}
for (const x of [undefined, 1, 41, 2.5]) console.log("returnsEarly", returnsEarly(x));

function negated(f) {
  const e = undefined;
  let a = 0;
  if (e !== f) a = 1;
  if (f !== e) return a + ":" + (f + 1);
  return a + ":none";
}
for (const x of [undefined, 1, 41, 2.5]) console.log("negated", negated(x));

function ternary(f) {
  const e = undefined;
  const a = e === f ? 1 : 0;
  return a + ":" + (f === e ? "none" : f + 1);
}
for (const x of [undefined, 1, 41, 2.5]) console.log("ternary", ternary(x));

function andOr(f, on) {
  const e = undefined;
  const a = e === f && on;
  const b = f === e || f + 1;
  const c = f !== e && f + 2;
  return [a, b, c].join();
}
for (const x of [undefined, 1, 41, 2.5]) console.log("andOr", andOr(x, true), andOr(x, false));

function switchCase(f) {
  const e = undefined;
  let a = 0;
  if (e === f) a = 1;
  switch (f) {
    case e:
      return a + ":none";
    default:
      return a + ":" + (f + 1);
  }
}
for (const x of [undefined, 1, 41, 2.5]) console.log("switchCase", switchCase(x));

function testOfLoop(f, turns) {
  const e = undefined;
  let sum = 0;
  if (e === f) sum = -1;
  for (let i = 0; i < turns && f !== e; i++) sum += f + i;
  return sum;
}
for (const x of [undefined, 1, 41, 2.5]) console.log("testOfLoop", testOfLoop(x, 3));

function walksList(list) {
  const end = null;
  let node = list,
    sum = 0;
  if (end === node) sum = -1;
  while (node !== end) {
    sum += node.value;
    node = node.next;
  }
  return sum;
}
for (const list of [null, { value: 1, next: null }, { value: 2, next: { value: 3, next: null } }])
  console.log("walksList", walksList(list));

function oneTextOfSeveral(f) {
  const e = "stop";
  let a = 0;
  if (e === f) a = 1;
  if (f === e) return a + ":stopped";
  return a + ":" + f + "!" + f.length;
}
for (const x of ["stop", "go", "wait"]) console.log("oneTextOfSeveral", oneTextOfSeveral(x));

function trueOrNumber(f) {
  const e = true;
  let a = 0;
  if (e === f) a = 1;
  if (f === e) return a + ":yes";
  return a + ":" + String(f) + ":" + typeof f;
}
for (const x of [true, false, 3]) console.log("trueOrNumber", trueOrNumber(x));

function lengthOfNothing(s) {
  const n = s.length,
    zero = 0;
  let a = 0;
  if (zero === n) a = 1;
  if (n === zero) return a + ":empty";
  return a + ":" + (n - 1) + ":" + s[n - 1];
}
for (const x of ["", "a", "abc"]) console.log("lengthOfNothing", lengthOfNothing(x));

function looselyNull(f) {
  const e = null;
  let a = 0;
  if (e == f) a = 1;
  if (f == e) return a + ":none";
  return a + ":" + (f + 1);
}
for (const x of [undefined, null, 1, 41]) console.log("looselyNull", looselyNull(x));

function bothAreParameters(e, f) {
  let a = 0;
  if (e === f) a = 1;
  if (f === e) return a + ":same";
  return a + ":" + (f + 1) + ":" + String(e);
}
for (const [e, f] of [
  [undefined, undefined],
  [undefined, 1],
  [undefined, 41],
])
  console.log("bothAreParameters", bothAreParameters(e, f));

function isMissing(value) {
  return undefined === value;
}
function throughHelper(f) {
  let a = 0;
  if (isMissing(f)) a = 1;
  if (f === undefined) return a + ":none";
  return a + ":" + (f + 1);
}
for (const x of [undefined, 1, 41, 2.5]) console.log("throughHelper", throughHelper(x));

function zeroOfEitherSign(a, b) {
  const c = b === a;
  if (a === b) return c + ":" + 1 / a + ":" + 1 / b;
  return c + ":differ";
}
const lefts = [-0, 0, 1, undefined, 0.5, 2],
  rights = [0, -0, 1, "x", 0.5, "2"];
for (let i = 0; i < lefts.length; i++) console.log("zeroOfEitherSign", zeroOfEitherSign(lefts[i], rights[i]));

function nullOrObject(f) {
  const e = null;
  let a = 0;
  if (e === f) a = 1;
  if (f === e) return a + ":none";
  return a + ":" + f.name;
}
for (const x of [null, { name: "x" }, { name: "y" }]) console.log("nullOrObject", nullOrObject(x));
