const iterations = 1_000;

export var report = {
  async: 0,
  callback: 0,
  sync: 0,
  then: 0,
};

const tests = {
  callback(n, cb) {
    if (n === iterations) return cb();
    tests.callback(1 + n, () => cb());
  },

  sync(n) {
    if (n === iterations) return;

    tests.sync(1 + n);
  },

  async async(n) {
    if (n === iterations) return;

    await tests.async(1 + n);
  },

  then(n) {
    if (n === iterations) return;
    return Promise.resolve(1 + n).then(tests.then);
  },
};

async function test(log) {
  {
    const a = performance.now();
    await tests.async(0);
    if (log) console.log(`async/await: ${(report.async = (performance.now() - a).toFixed(4))}ms`);
  }

  {
    const a = performance.now();
    tests.callback(0, function () {
      if (log) console.log(`callback: ${(report.callback = (performance.now() - a).toFixed(4))}ms`);
    });
  }

  {
    const a = performance.now();
    await tests.then(0);
    if (log) console.log(`then: ${(report.then = (performance.now() - a).toFixed(4))}ms`);
  }

  {
    const a = performance.now();
    tests.sync(0);
    if (log) console.log(`sync: ${(report.sync = (performance.now() - a).toFixed(4))}ms`);
  }
}

let warmup = 10;
while (warmup--) await test();

await test(true);
