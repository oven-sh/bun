export {};
const worker = new Worker(new URL("./job.worker.ts", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.postMessage(21);
