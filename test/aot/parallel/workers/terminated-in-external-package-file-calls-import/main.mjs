// A Worker is terminated while a CommonJS package that is marked external loops. The package is loaded for an importer whose CommonJS file, one level below, calls import().
// Flags: --external outside-loop
// Entry points: ./worker.mjs
const worker = new Worker("./worker.mjs");
const closed = new Promise(resolve => worker.addEventListener("close", resolve));
worker.onmessage = event => {
  console.log("the Worker is", event.data);
  worker.terminate();
  const bound = setTimeout(() => {
    console.log("the Worker still runs");
    process.exit(1);
  }, 10_000);
  closed.then(() => clearTimeout(bound));
};
await closed;
console.log("the Worker is closed");
