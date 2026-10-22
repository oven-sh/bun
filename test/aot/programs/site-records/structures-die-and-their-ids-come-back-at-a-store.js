// A store learns where an ordinary object keeps the field, or which structure the object gets when the store creates the field. Those structures die, and new ones get their ids. A store by the old knowledge would overwrite a neighbor, write past the object, or give it a dead structure.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

class Expected {
  constructor() {
    this.level = 1;
  }
}

function setLevel(value, level) {
  value.level = level;
}
function setExtra(value, extra) {
  value.extra = extra;
}

function teach(round) {
  const replaces = {};
  replaces["only in round " + round] = 0;
  replaces.pad = "pad";
  replaces.level = "old";
  const creates = {};
  creates["created in round " + round] = 0;
  setLevel(unknown(replaces), "replaced");
  setLevel(unknown(replaces), "replaced twice");
  setLevel(unknown(creates), "created");
  setExtra(unknown(creates), "extra");
  const createsAgain = {};
  createsAgain["created in round " + round] = 0;
  setLevel(unknown(createsAgain), "created again");
  setExtra(unknown(createsAgain), "extra again");
  return JSON.stringify([replaces, creates, createsAgain]);
}
function fillStack(depth) {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fillStack(depth - 1) + some.length : 0;
}

let wrong = 0;
function check(actual, expected) {
  if (actual !== expected) {
    wrong++;
    if (wrong < 10) console.log("WRONG:", actual, "instead of", expected);
  }
}

function successor(round, index) {
  const first = "successor " + round + " " + index;
  const value = {};
  value[first] = "first";
  const stored = "L" + index;
  switch (index % 6) {
    case 0:
      value.level = "old";
      value.after = "after";
      return [value, { [first]: "first", level: stored, after: "after", extra: index }];
    case 1:
      value.a = "a";
      value.b = "b";
      value.c = "c";
      value.level = "old";
      return [value, { [first]: "first", a: "a", b: "b", c: "c", level: stored, extra: index }];
    case 2:
      return [value, { [first]: "first", level: stored, extra: index }];
    case 3:
      value.pad = "pad";
      value.other = "other";
      return [value, { [first]: "first", pad: "pad", other: "other", level: stored, extra: index }];
    case 4:
      value.extra = "old extra";
      value.pad = "pad";
      return [value, { [first]: "first", extra: index, pad: "pad", level: stored }];
    default:
      value.pad = "pad";
      value.level = "old";
      return [value, { [first]: "first", pad: "pad", level: stored, extra: index }];
  }
}

for (let round = 0; round < 8; round++) {
  const honest = new Expected();
  setLevel(honest, round);
  console.log(JSON.stringify(honest), teach(round));
  fillStack(50);
  Bun.gc(true);
  const kept = [];
  for (let index = 0; index < 600; index++) {
    const [value, expected] = successor(round, index);
    kept.push(value);
    setLevel(unknown(value), "L" + index);
    setExtra(unknown(value), index);
    check(JSON.stringify(value), JSON.stringify(expected));
  }
  Bun.gc(true);
  let length = 0;
  for (const value of kept) length += JSON.stringify(value).length;
  console.log("round", round, "kept", kept.length, "wrong", wrong, "length", length);
}

export {};
