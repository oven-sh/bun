// Promises that are settled already, Promise.all once, an async generator.
// Sizes: 1000 4000 16000
// Passes: 230
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
async function one(i: number): Promise<number> {
  return i & 7;
}
async function* stream(count: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) yield i & 3;
}
async function once(): Promise<string> {
  let sum = 0;
  for (let i = 0; i < size * 2; i++) sum += await one(i);
  sum += (await Promise.all(Array.from({ length: size }, (_, i) => one(i)))).length;
  for await (const x of stream(size)) sum += x;
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = await once();
console.log(told);
