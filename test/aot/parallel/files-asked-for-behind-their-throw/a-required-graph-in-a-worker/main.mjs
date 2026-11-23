const worker = new Worker(new URL("./worker.cjs", import.meta.url).href);
worker.onmessage = event => console.log("message", event.data);
worker.onerror = event => {
  event.preventDefault();
  console.log("error");
};
worker.addEventListener("close", () => console.log("close"));
