const worker = new Worker("./job");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.onerror = event => console.log("ERROR", event.message);
