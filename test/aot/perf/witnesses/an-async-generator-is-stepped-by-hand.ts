// `await generator.next()` costs what a turn of `for await` costs: no promise, no iterator result, no job.
async function* numbers(count: number): AsyncGenerator<number, string, number | undefined> {
  let sent = 0;
  for (let i = 0; i < count; i++) sent += (yield i) ?? 0;
  return "sent " + sent;
}
async function destructures(count: number): Promise<number> {
  const generator = numbers(count);
  let sum = 0;
  for (;;) {
    const { value, done } = await generator.next();
    if (done) return sum + value.length;
    sum = (sum + value) | 0;
  }
}
async function keepsTheResult(count: number): Promise<number> {
  const generator = numbers(count);
  let sum = 0;
  for (;;) {
    const result = await generator.next(1);
    if (result.done) return sum + result.value.length;
    sum = (sum + result.value) | 0;
  }
}
async function* doubles(count: number): AsyncGenerator<number> {
  const generator = numbers(count);
  for (;;) {
    const { value, done } = await generator.next();
    if (done) return;
    yield value * 2;
  }
}
async function readsInPlace(count: number): Promise<number> {
  const generator = doubles(count);
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + ((await generator.next()).value as number)) | 0;
  return sum;
}
const count = 60_000;
console.log(await destructures(count), await keepsTheResult(count), await readsInPlace(count));
