// An interface below a built-in type in the entry point, an object type with its member behind the Worker.
// Flags: --aot-threads=1
// Entry points: ./worker.ts
interface CodedError extends Error {
  code: number;
}
const error = Object.assign(new Error("e"), { code: 41 }) as CodedError;
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data + error.code);
  worker.terminate();
};
