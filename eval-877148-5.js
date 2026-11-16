process.argv.splice(1, 1);
    const { Worker } = require("worker_threads");
    const results = {};
    const configs = [{ now: 0, target: 1e12 }, { now: 2 ** 40, target: 0 }];
    let done = 0;
    for (const workerData of configs) {
      const w = new Worker("\n    const { jest } = Bun.jest(__filename);\n    const { parentPort, workerData } = require(\"worker_threads\");\n    const { now, target } = workerData;\n    const mismatches = [];\n    for (let r = 0; r < 400; r++) {\n      jest.useFakeTimers({ now });\n      let n = 0;\n      setTimeout(() => n++, 1000);\n      const iv = setInterval(() => { if (n++ > 3) clearInterval(iv); }, 100);\n      jest.setSystemTime(target);\n      jest.runOnlyPendingTimers();\n      const after = Date.now();\n      if (after !== target + 1000) mismatches.push({ round: r, after, expected: target + 1000 });\n      jest.useRealTimers();\n    }\n    parentPort.postMessage(mismatches);\n  ", { eval: true, workerData });
      w.on("error", err => { console.error(err); process.exit(1); });
      w.on("message", mismatches => {
        results[workerData.now] = mismatches;
        if (++done === configs.length) {
          console.log(JSON.stringify(results));
          process.exit(0);
        }
      });
    }
  