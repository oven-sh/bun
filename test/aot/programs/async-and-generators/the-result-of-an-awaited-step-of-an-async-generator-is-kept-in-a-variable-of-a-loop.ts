// Steps through async generators by hand. The result of each awaited step goes into a variable that the loop assigns again, so it is an object that somebody holds.
async function* count(to: number): AsyncGenerator<number, string> {
  for (let i = 1; i <= to; i++) yield i;
  return "end of " + to;
}
async function* fails(after: number): AsyncGenerator<number, string> {
  for (let i = 1; i <= after; i++) yield i;
  throw new Error("failed after " + after);
}
async function walk(stream: AsyncGenerator<number, string>): Promise<string> {
  let sum = 0;
  let outcome: string;
  try {
    let step = await stream.next();
    while (!step.done) {
      sum += step.value;
      step = await stream.next();
    }
    outcome = "returned " + step.value + " " + Object.keys(step).join();
  } catch (error) {
    outcome = "caught " + (error as Error).message;
  }
  const after = await stream.next();
  return sum + ", " + outcome + ", then " + after.done + " " + after.value;
}
console.log(await walk(count(0)));
console.log(await walk(count(4)));
console.log(await walk(fails(3)));

export {};
