import { bench, run } from "../runner.mjs";

const nonThenable = { value: 42 };

bench("Promise.resolve(object).then(fn)", async () => {
  await Promise.resolve(nonThenable).then(v => v);
});

bench("Promise.resolve({object literal})", () => {
  return Promise.resolve({ a: 1, b: 2, c: 3 });
});

bench("await {object literal}", async () => {
  const o = await { a: 1, b: 2, c: 3 };
  return o.a;
});

bench("new Promise(r => r(1)).then(fn)", async () => {
  await new Promise(r => r(1)).then(v => v);
});

bench(".then() chain x 10", async () => {
  let p = Promise.resolve(0);
  for (let i = 0; i < 10; i++) {
    p = p.then(v => v + 1);
  }
  await p;
});

async function inner() {
  return 1;
}

async function middle() {
  return (await inner()) + 1;
}

bench("await async fn (depth 2)", async () => {
  return await middle();
});

bench("await chain x 20 (single-await async fns)", async () => {
  let v = 0;
  for (let i = 0; i < 20; i++) {
    v += await inner();
  }
  return v;
});

bench("async generator: 10 yields", async () => {
  async function* gen() {
    for (let i = 0; i < 10; i++) yield i;
  }
  let sum = 0;
  for await (const v of gen()) sum += v;
  return sum;
});

await run();
