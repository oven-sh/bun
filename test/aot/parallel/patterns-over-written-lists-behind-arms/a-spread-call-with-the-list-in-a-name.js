const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function sum(a, b) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return a * 10 + b + work; }
function take(at, tools, plain, loud) {
  const steps = plain ? { step: 1 } : { step: 2 };
  const pair = [tools.round(at + 0.5) + steps.step, at];
  const mark = loud ? "!" : ".";
  return sum(...pair) + mark;
}
console.log(take(1, kit, true, true), take(2, kit, false, false));
