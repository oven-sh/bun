import { performance } from "perf_hooks";
import { bench, run } from "../runner.mjs";

bench("process.memoryUsage()", () => {
  process.memoryUsage();
});

bench("process.memoryUsage.rss()", () => {
  process.memoryUsage.rss();
});

bench("process.cpuUsage()", () => {
  process.cpuUsage();
});

const init = process.cpuUsage();
bench("process.cpuUsage(delta)", () => {
  process.cpuUsage(init);
});

bench("performance.now()", () => {
  performance.now();
});

bench("process.hrtime()", () => {
  process.hrtime();
});

bench("process.hrtime.bigint()", () => {
  process.hrtime.bigint();
});

await run();
