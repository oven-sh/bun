let count = 20_000_000;
const batchSize = 1_000_000;
console.time("Run");

let { promise, resolve, reject } = Promise.withResolvers();
let remaining = count;

if (batchSize === 0) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      remaining--;
      if (remaining === 0) {
        resolve();
      }
    }, 0);
  }
  await promise;
} else {
  for (let i = 0; i < count; i += batchSize) {
    let batch = Math.min(batchSize, count - i);
    console.time("Batch " + i + " - " + (i + batch));
    let { promise: batchPromise, resolve: batchResolve } = Promise.withResolvers();
    let remaining = batch;
    for (let j = 0; j < batch; j++) {
      setTimeout(() => {
        remaining--;
        if (remaining === 0) {
          batchResolve();
        }
      }, 0);
    }
    await batchPromise;
    console.timeEnd("Batch " + i + " - " + (i + batch));
  }
}

const fmt = new Intl.NumberFormat();
console.log("Executed", fmt.format(count), "timers");
console.timeEnd("Run");
process.exit(0);
