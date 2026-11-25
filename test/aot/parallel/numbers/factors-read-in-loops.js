// Numbers that loops multiply and truncate, read out of variables, parameters and fields. Some loops use them in other ways too.
const lines = [];
let calls = 0;
const counted = value => ({
  valueOf() {
    calls++;
    return value;
  },
});
const list = [1, 2, 4, 8, 16, 32, 64];
let rate = JSON.parse("1.5");
function setRate(value) {
  rate = value;
}
const same = value => value;

function ofVariable() {
  let s = 0;
  for (let i = 0; i < 5; i++) s += (i * rate) | 0;
  return s;
}
function keysOfVariable() {
  let s = 0;
  for (let y = 0; y < 3; y++) {
    const row = ((y * rate) | 0) * 2;
    for (let x = 0; x < 3; x++) {
      const v = list[row + ((x * rate) | 0)];
      s += v === undefined ? 1000 : v;
    }
  }
  return s;
}
function alsoText() {
  let s = "";
  for (let i = 0; i < 4; i++) s += rate + ":" + ((i * rate) | 0) + ";";
  return s;
}
function alsoHanded() {
  let s = 0;
  for (let i = 0; i < 4; i++) s += same(rate) * i;
  return s;
}
function writtenInLoop() {
  let s = 0;
  for (let i = 0; i < 6; i++) {
    s += (i * rate) | 0;
    if (i === 2) setRate(0.5);
  }
  return s;
}
function ofParameter(r) {
  let s = 0;
  for (let i = 0; i < 5; i++) s += ((i * r) | 0) + r * i;
  return s;
}
function dividesAndCompares(r) {
  let s = 0;
  for (let i = 0; i < 5; i++) if (i < r) s += r / (i + 1) - r;
  return s;
}
class Player {
  constructor(r) {
    this.rate = r;
  }
  play() {
    let s = 0;
    for (let i = 0; i < 5; i++) {
      const v = list[(i * this.rate) | 0];
      s += v === undefined ? 1000 : v;
    }
    return s;
  }
}
function show(x) {
  return typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : String(x);
}
function say(name, f) {
  calls = 0;
  let result;
  try {
    result = show(f());
  } catch (error) {
    result = error.name;
  }
  lines.push(name + " " + calls + " " + result);
}
const values = [
  ...JSON.parse("[0, 1, 2, 1.5, 0.25, -0.5, -2, 2147483647, 2147483648, 1e21, 9007199254740993]"),
  -0,
  NaN,
  Infinity,
  "3",
  "1.5",
  "x",
  null,
  undefined,
  true,
  [2],
  {},
  3n,
  counted(1.5),
];
for (let round = 0; round < 2; round++) {
  values.forEach((value, i) => {
    setRate(value);
    say("variable " + i, ofVariable);
    say("keys " + i, keysOfVariable);
    say("text " + i, alsoText);
    say("handed " + i, alsoHanded);
    say("written " + i, writtenInLoop);
    say("parameter " + i, () => ofParameter(value));
    say("compares " + i, () => dividesAndCompares(value));
    say("field " + i, () => new Player(value).play());
  });
}
console.log(lines.join("\n"));
