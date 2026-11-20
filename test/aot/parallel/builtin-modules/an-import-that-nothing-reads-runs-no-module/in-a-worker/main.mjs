// The file of a worker imports the modules and reads none. Neither thread runs a module of Bun for them: a worker asks for three when it starts.
// COUNT: operation:operationAOTRequireModule <= 3
const worker = new Worker(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
