const worker = new Worker(new URL("job.mjs", import.meta.url).href);
const said = await new Promise(resolve => {
  worker.onmessage = event => resolve("says " + event.data);
  worker.onerror = () => resolve("fails");
  worker.postMessage("go");
});
worker.terminate();
console.log(said);
