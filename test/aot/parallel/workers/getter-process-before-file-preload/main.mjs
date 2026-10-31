// A getter that a preloaded file put on process runs before the CommonJS file that the entry point of the Worker names behind node:process.
// Alone: a relative name is looked for from the folder in which the program is built
const worker = new Worker("./worker.mjs", { preload: "./preload.mjs" });
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
