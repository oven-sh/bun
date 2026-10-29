// Entry points: ./worker.js
const worker = new Worker("./worker.js");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
worker.onerror = event => console.log(event.message);
/* Output:
eval in a worker: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
Function in a worker: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
*/
