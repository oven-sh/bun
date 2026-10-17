// queues a tick with two arguments
const operations = 20;
let sum = 0;
const add = (a: number, b: number) => {
  sum += a + b;
};
for (let i = 0; i < 64; i++) process.nextTick(add, i, 1);
await new Promise<void>(resolve => setImmediate(resolve));

kernel: {
  for (let i = 0; i < operations; i++) process.nextTick(add, i, 1);
}

await new Promise<void>(resolve => setImmediate(resolve));
console.log(sum);
