import { bench, run } from "../runner.mjs";

bench("noop", function () {});
bench("async function(){}", async function () {});
bench("await 1", async function () {
  return await 1;
});

if (typeof process !== "undefined") {
  bench("process.nextTick x 100", async function () {
    var remaining = 100;
    var cb, promise;
    promise = new Promise(resolve => {
      cb = resolve;
    });

    for (let i = 0; i < 100; i++) {
      process.nextTick(() => {
        if (--remaining === 0) cb();
      });
    }

    return promise;
  });

  bench("await 1 x 100", async function () {
    for (let i = 0; i < 100; i++) await 1;
  });
}

bench("await new Promise(resolve => resolve())", async function () {
  await new Promise(resolve => resolve());
});

await run();
