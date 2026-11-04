// declared function read by a callee
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a function that is entered itself reads the name of its neighbor as a value keeps its cell: what it holds is read behind later runs.
const list: Array<() => number> = [];
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; return held; }
  function note(k: boolean) { bump(); if (k) list.push(bump); }
  note(keep);
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, list[0](), list[1](), list[0](), list[1]());
