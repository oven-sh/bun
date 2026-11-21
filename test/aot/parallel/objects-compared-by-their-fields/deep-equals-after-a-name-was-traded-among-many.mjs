// Of 150 names and one above them, one is deleted and an undefined one takes its place: the count is the same and the objects differ, both ways round.
import assert from "node:assert";
import { isDeepStrictEqual } from "node:util";

const names = Array.from({ length: 150 }, (_, at) => "ware" + at);
function make() {
  const stall = Object.assign(Object.create({ market: 1 }), { owner: "Ida" });
  for (const name of names) stall[name] = name.length;
  return stall;
}
const changes = {
  none: () => {},
  putAway: stall => {
    stall[names[75]] = undefined;
  },
  oneMorePutAway: stall => {
    stall.spare = undefined;
  },
  oneMore: stall => {
    stall.spare = 1;
  },
  oneLess: stall => {
    delete stall[names[0]];
  },
  another: stall => {
    delete stall[names[0]];
    stall.spare = 1;
  },
  anotherPutAway: stall => {
    delete stall[names[0]];
    stall.spare = undefined;
  },
};
for (const change in changes) {
  const one = make();
  const other = make();
  changes[change](other);
  console.log(change, Bun.deepEquals(other, one));
}
for (const change in changes) {
  const one = make();
  const other = make();
  changes[change](other);
  let loosely = true;
  try {
    assert.deepEqual(one, other);
  } catch {
    loosely = false;
  }
  console.log(change, Bun.deepEquals(one, other), Bun.deepEquals(one, other, true), isDeepStrictEqual(one, other), loosely);
}
