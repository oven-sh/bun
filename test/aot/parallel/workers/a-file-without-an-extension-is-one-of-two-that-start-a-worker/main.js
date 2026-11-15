const worker = new Worker(process.argv.length > 99 ? "./other.js" : "./job");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.onerror = event => console.log("ERROR", event.message);
