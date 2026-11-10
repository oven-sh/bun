// A loop over an object stands in the turn of a generator method with two yields: the outer generator is walked in its loop, the inner one is made.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
class Pair { constructor(private first: number, private second: number) {} *[Symbol.iterator]() { yield this.first; yield this.second; } }
function weigh(left: Pair, right: Pair): number {
  let sum = 0;
  for (const a of left) { let last = 0; for (const b of right) last = last * 10 + b; sum = sum * 100 + a * last; }
  return sum;
}
for (let turn = 0; turn < 3; turn++) console.log(weigh(new Pair(1, 2), new Pair(3, turn)));
