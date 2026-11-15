// Entry points: ./worker.js
const worker = new Worker("./worker.js");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.onerror = event => console.log(event.message);
