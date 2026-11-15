const worker = new Worker("./jo" + (process.argv.length > 99 ? "x" : "b"));
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.onerror = event => console.log("ERROR", event.message);
