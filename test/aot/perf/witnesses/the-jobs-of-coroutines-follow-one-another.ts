// Where a coroutine has to wait a turn, the jobs that finish a yield, resume a consumer and go on behind an await run one behind the other without the job loop in between.
async function* numbers(count: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) yield i;
}
async function* pauses(count: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) {
    await null;
    yield i;
  }
}
async function one(generator: AsyncGenerator<number>): Promise<number> {
  const { value, done } = await generator.next();
  return done ? -1 : value;
}
async function everyStepInANewCall(count: number): Promise<number> {
  const generator = numbers(count);
  let sum = 0;
  for (;;) {
    const value = await one(generator);
    if (value < 0) return sum;
    sum = (sum + value) | 0;
  }
}
function startedByACallback(count: number): Promise<number> {
  const generator = numbers(count);
  let sum = 0;
  return new Promise(resolve => {
    async function step(): Promise<void> {
      const { value, done } = await generator.next();
      if (done) return resolve(sum);
      sum = (sum + value) | 0;
      read();
    }
    function read() {
      step();
    }
    read();
  });
}
async function twoLoopsSideBySide(count: number): Promise<number> {
  async function loop(generator: AsyncGenerator<number>): Promise<number> {
    let sum = 0;
    for await (const value of generator) sum = (sum + value) | 0;
    return sum;
  }
  const sums = await Promise.all([loop(numbers(count)), loop(pauses(count))]);
  return (sums[0] + sums[1]) | 0;
}
async function whatAMethodReturns(count: number): Promise<number> {
  const iterable = { [Symbol.asyncIterator]: () => Object.assign(pauses(count), { tag: "kept" }) };
  let sum = 0;
  for await (const value of iterable) sum = (sum + value) | 0;
  return sum;
}
let check = 0;
for (let round = 0; round < 20; round++) {
  check = (check + (await everyStepInANewCall(2000))) | 0;
  check = (check + (await startedByACallback(2000))) | 0;
  check = (check + (await twoLoopsSideBySide(2000))) | 0;
  check = (check + (await whatAMethodReturns(2000))) | 0;
}
console.log(check);
