// The default export of a Worker's file is an instance of a class with `fetch` and a getter named `stop`. It is served in the Worker.
const worker = new Worker(new URL("./worker.ts", import.meta.url));
worker.addEventListener("error", event => console.log("error", event.message));
worker.addEventListener("close", () => console.log("the worker is closed"));
