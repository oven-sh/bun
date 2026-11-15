class JobWorker extends Worker {}
const name = process.argv[2] ?? "a";
const worker = new JobWorker(new URL("./jobs/" + name + ".mjs", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
