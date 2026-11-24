// == between fields that hold links and null, links and undefined, or all three, in loops over trees and chains.
"use strict";
class Branch {
  constructor(size, above) {
    this.size = size;
    this.above = above;
    this.near = null;
    this.far = null;
    this.mark = undefined;
  }
  add(size) {
    let branch = this;
    for (;;) {
      const goesNear = size < branch.size;
      const next = goesNear ? branch.near : branch.far;
      if (next == null) {
        const added = new Branch(size, branch);
        if (goesNear) branch.near = added;
        else branch.far = added;
        return added;
      }
      branch = next;
    }
  }
}
function following(branch) {
  if (branch.far != null) {
    branch = branch.far;
    while (branch.near != null) branch = branch.near;
    return branch;
  }
  let above = branch.above;
  while (above != undefined && branch == above.far) {
    branch = above;
    above = above.above;
  }
  return above;
}
function sizes(root) {
  const out = [];
  let branch = root;
  while (branch.near != null) branch = branch.near;
  for (; branch != null; branch = following(branch)) out.push(branch.size);
  return out;
}
function alike(one, two) {
  let same = 0;
  for (; one != null && two != null; one = one.above, two = two.above) {
    same = same * 2 + (one == two) + 2 * (one.near == two.far) + 4 * (one.mark == two.mark) + 8 * (one.mark == two.near);
    same %= 1000003;
  }
  return same + ":" + (one == two) + ":" + (one === two);
}
const roots = [];
for (let round = 0; round < 20; round++) {
  const root = new Branch(50, round % 2 ? null : undefined);
  const added = [];
  for (let at = 0; at < 24; at++) added.push(root.add((at * 37 + round) % 101));
  added[3].mark = null;
  added[5].mark = root;
  added[7].mark = added[7];
  roots.push(root);
  const answers = [];
  for (let at = 1; at < added.length; at++) answers.push(alike(added[at], added[at - 1]));
  if (round % 6 === 0) console.log(sizes(root).join(), answers.join(" "));
}
const odd = new Branch(1, null);
for (const mark of [0, "", false, NaN, [], "undefined", null, undefined, 0n, Symbol.iterator]) {
  odd.mark = mark;
  const other = new Branch(1, undefined);
  console.log(typeof mark, odd.mark == other.mark, odd.mark == odd.near, odd.mark != odd.above, odd.near == other.above, other.above == odd.above, odd.mark == odd.mark);
}
odd.mark = { valueOf: () => 7, toString: () => "odd" };
console.log(odd.mark == 7, odd.mark == null, odd.mark == odd, odd == odd.mark, odd.mark == "odd");
const bare = Object.create(Branch.prototype);
console.log(bare.near == null, bare.near == odd.near, bare == null, alike(bare, odd), alike(odd, bare));
