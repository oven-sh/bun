// The worker of the web, started from the program's own entry point.
if (Bun.isMainThread) {
  const worker = new Worker(import.meta.url);
  worker.onmessage = event => {
    console.log("main thread:", import.meta.main, "worker:", event.data);
    worker.terminate();
  };
} else {
  postMessage(import.meta.main ? "main" : "not main");
}
