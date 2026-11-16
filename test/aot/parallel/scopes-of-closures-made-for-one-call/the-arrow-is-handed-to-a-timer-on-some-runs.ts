const kept: Array<() => number> = [];
let late = 0;
function soon(f: () => void): void { setTimeout(f, 0); }
function now(f: () => void): void { f(); }
function maker(start: number, keep: boolean): number {
  let held = start;
  if (keep) soon(() => { late += held; });
  else now(() => { held++; });
  held += 2;
  return held;
}
setTimeout(() => console.log("late", late), 200);

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
