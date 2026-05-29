import { bench, run } from "../runner.mjs";

function plainValues(n) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  return arr;
}

function resolvedPromises(n) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = Promise.resolve(i);
  return arr;
}

const plain10 = plainValues(10);
const plain1000 = plainValues(1000);

bench("Promise.all(10 plain values)", async () => {
  await Promise.all(plain10);
});

bench("Promise.all(1000 plain values)", async () => {
  await Promise.all(plain1000);
});

bench("Promise.all(10 resolved promises)", async () => {
  await Promise.all(resolvedPromises(10));
});

bench("Promise.all(1000 resolved promises)", async () => {
  await Promise.all(resolvedPromises(1000));
});

bench("Promise.allSettled(1000 plain values)", async () => {
  await Promise.allSettled(plain1000);
});

bench("Promise.any(1000 plain values)", async () => {
  await Promise.any(plain1000);
});

bench("Promise.race(1000 plain values)", async () => {
  await Promise.race(plain1000);
});

await run();
