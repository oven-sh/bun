class Box {
  constructor(public n: number, public next: Box | null) {}
}
function* count(a: number): Generator<number, number, number> {
  let last = 0;
  let held: any = new Box(a, null);
  let turns = 2;
  do {
    if (typeof held === "number") {
    } else {
      held = last;
    }
    last = ((yield last) + 1) | 0;
  } while (--turns > 0);
  return held + last;
}
let sum = 0;
for (let i = 0; i < 20; i++) {
  const steps = count(i);
  for (let step = steps.next(0); !step.done; step = steps.next(sum & 7)) sum += step.value;
}
console.log(sum);
