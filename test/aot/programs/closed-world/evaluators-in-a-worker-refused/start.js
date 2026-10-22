const worker = new Worker("./main.js");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.onerror = event => console.log(event.message);
