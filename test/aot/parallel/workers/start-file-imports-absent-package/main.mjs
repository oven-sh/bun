// Build prints: 1 x warn: TS100151: Could not resolve: "not-installed-anywhere". Maybe you need to "bun install"?
const worker = new Worker(new URL("./job.js", import.meta.url).href);
worker.onerror = event => {
  console.log("error event", String(event.message).includes("not-installed-anywhere"));
  console.log("the program goes on");
  process.exit();
};
worker.onmessage = event => {
  console.log("message", event.data);
  process.exit();
};
