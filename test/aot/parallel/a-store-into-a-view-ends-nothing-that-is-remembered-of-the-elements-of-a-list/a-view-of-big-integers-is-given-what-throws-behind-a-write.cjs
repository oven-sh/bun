"use strict";
// The conversion writes the list and throws.
const list = [1.5, 2.5, 3.5, 4.5], rows = [[1.5, 2.5], [3.5, 4.5], [5.5, 6.5]];
function lay(view, stored, at, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const before = list[0], row = rows[1];
    view[at] = stored;
    sum += list[0] - before + (rows[1] === row ? 0 : 100) + rows[1][0];
  }
  return sum;
}
function once(view, stored, at) { const before = list[0], row = rows[1]; view[at] = stored; return [before, list[0], rows[1] === row, rows[1][0]].join(","); }
const said = [];
function tell(make, stored, at) {
  for (let round = 0; round < 6; round++) {
    list[0] = 1.5; rows[1] = [3.5, 4.5];
    const hostile = round > 2;
    try { said.push(lay(make(), hostile ? stored(round) : round + 0.5, hostile ? at(round) : 1, 3)); } catch (error) { said.push(error.name + ":" + list[0] + ":" + rows[1][0]); }
    list[0] = 1.5; rows[1] = [3.5, 4.5];
    try { said.push(once(make(), hostile ? stored(round) : round + 0.5, hostile ? at(round) : 1)); } catch (error) { said.push(error.name + ":" + list[0] + ":" + rows[1][0]); }
  }
}
tell(() => new BigInt64Array(4), round => round > 2 && round < 5 ? ({ valueOf() { list[0] = list[0] + 8; rows[1] = [round + 0.25, 9]; return 1; } }) : 5n, () => 1);
tell(() => new BigInt64Array(4), round => ({ valueOf() { list[0] = list[0] + 8; rows[1] = [round + 0.25, 9]; throw new RangeError("no"); } }), () => 1);
console.log(said.join(" | "));
