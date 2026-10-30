// A file that the `preload` option of a worker names is code. One that is not in the executable is refused like a computed require() of it, and the worker reports the error.
const { resolve } = require("node:path");

const parts = ["./before", ".js"];
const worker = new Worker("./worker.js", { preload: [resolve(parts.join(""))] });
worker.onmessage = event => {
  console.log("message:", event.data);
  worker.terminate();
};
worker.onerror = event => {
  console.log("refused:", String(event.message).includes("isn't in this executable"));
};
/* Output:
refused: true
*/
