// `a.length = v` looks like a store of v into a. An array makes a number of v first: valueOf, toString or Symbol.toPrimitive of v run, with v as `this`, and the array holds the number, not v.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
function setLength(target, v) {
  target.length = v;
}
function intoOwnArray(v) {
  const a = [1, 2, 3];
  a.length = v;
  return a.length;
}
function intoOwnObject(v) {
  const o = { length: 0 };
  o.length = v;
  return typeof o.length;
}
function withValueOf(tag) {
  return {
    tag,
    list: [tag],
    valueOf() {
      kept.push(this);
      return 2;
    },
  };
}
function withToPrimitive(tag) {
  return {
    tag,
    list: [tag],
    [Symbol.toPrimitive]() {
      kept.push(this);
      return 1;
    },
  };
}
const answers = [];
for (let round = 0; round < 40; round++) {
  const a = [1, 2, 3, 4];
  setLength(a, withValueOf(round));
  setLength({ length: 1 }, withValueOf(-round));
  answers.push(a.length, intoOwnArray(withToPrimitive(round + 100)), intoOwnObject(withValueOf(round + 200)));
  if (round % 8 === 0) churn(20);
}
churn(40);
let sum = 0;
for (const value of kept) sum += value.tag + value.list[0];
console.log(kept.length, sum, answers.slice(0, 6).join());
try {
  intoOwnArray({ valueOf: () => -1 });
} catch (error) {
  console.log(error instanceof RangeError);
}
