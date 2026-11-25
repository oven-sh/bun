const worker = new Worker(new URL("./job.mjs", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
