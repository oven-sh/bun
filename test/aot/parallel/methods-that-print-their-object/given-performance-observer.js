// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const { PerformanceObserver, performance: perf } = require("node:perf_hooks");
const done = new Promise(resolve => {
  const observer = new PerformanceObserver(list => { resolve(String(Bun.inspect(list.getEntries()[0])).split("\n")[0]); observer.disconnect(); });
  observer.observe({ entryTypes: ["mark"] });
});
perf.mark("seen");
console.log(await done);
