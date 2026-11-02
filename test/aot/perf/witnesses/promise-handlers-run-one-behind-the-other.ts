// then on a pending promise is two stores, and the jobs that call handlers and queued functions run one behind the other without the job loop in between.
function chainOfThens(count: number): Promise<number> {
  let promise = Promise.resolve(0);
  for (let i = 0; i < count; i++) promise = promise.then(value => (value + i) | 0);
  return promise;
}
function chainOfCatches(count: number): Promise<number> {
  let promise: Promise<number> = Promise.reject(0);
  for (let i = 0; i < count; i++) promise = i & 1 ? promise.then(value => { throw value + 1; }) : promise.catch(reason => (reason as number) + 1);
  return promise.catch(reason => reason as number);
}
function queuedFunctions(count: number): Promise<number> {
  return new Promise(resolve => {
    let sum = 0, i = 0;
    const next = () => {
      sum = (sum + i) | 0;
      if (++i < count) queueMicrotask(next);
      else resolve(sum);
    };
    queueMicrotask(next);
  });
}
async function resolvedByAHandler(count: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const { promise, resolve } = Promise.withResolvers<number>();
    Promise.resolve(i).then(resolve);
    sum = (sum + (await promise)) | 0;
  }
  return sum;
}
let check = 0;
for (let round = 0; round < 20; round++) {
  check = (check + (await chainOfThens(4000))) | 0;
  check = (check + (await chainOfCatches(400))) | 0;
  check = (check + (await queuedFunctions(4000))) | 0;
  check = (check + (await resolvedByAHandler(2000))) | 0;
}
console.log(check);
