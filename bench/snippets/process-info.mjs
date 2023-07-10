import { bench, run } from "./runner.mjs";

bench("process.memoryUsage()", () => {
  process.memoryUsage();
});

bench("process.cpuUsage()", () => {
  process.cpuUsage();
});

const init = process.cpuUsage();
bench("process.cpuUsage(delta)", () => {
  process.cpuUsage(init);
});

bench("process.memoryUsage.rss()", () => {
  process.memoryUsage.rss();
});

await run();

// Bun.gc();
// await 123;
// await 456;
// await Bun.sleep(5);
globalThis.abc = Buffer.from("county");
console.log(process.memoryUsage());
