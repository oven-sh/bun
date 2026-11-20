class JobWorker extends Worker {
  constructor(name) {
    super(new URL("./jobs/" + name + ".mjs", import.meta.url).href);
  }
}
const worker = new JobWorker(process.argv[2] ?? "b");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
