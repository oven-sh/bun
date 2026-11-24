// A Worker starts at part.ts, an entry point, and `import()` names part.js, a module of the same stem.
// Entry points: ./part.ts
const start = async name => {
  const worker = new Worker(name);
  const said = await new Promise(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => resolve("failed: " + event.message);
  });
  worker.terminate();
  return said;
};
console.log(await start(new URL("./part.ts", import.meta.url).href));
const part = await import("./part.js");
console.log(part.kind);
console.log(await start(new URL("./part.ts", import.meta.url).href));
