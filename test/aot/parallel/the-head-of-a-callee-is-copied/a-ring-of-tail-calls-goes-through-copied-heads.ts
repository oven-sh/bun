class Step { left: number; done: number; last: Step | undefined; constructor(left: number) { this.left = left; this.done = 0; this.last = undefined; } }
let turns = 0;
function advance(step: Step): Step {
  if (step.last) return step.last;
  turns++;
  step.left--;
  step.done += 2;
  if (step.left === 0) step.last = step;
  return hop(step);
}
function hop(step: Step): Step { return advance(step); }
const ended = hop(new Step(400000));
console.log(ended.left, ended.done, turns, hop(ended) === ended, turns);
