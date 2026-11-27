export async function run() {
  const helper = new Worker(new URL(import.meta.url));
  await new Promise<void>(done => {
    helper.onmessage = event => {
      console.log("message", event.data);
      helper.terminate();
      done();
    };
    helper.onerror = event => {
      console.log("error", String(event.message).slice(0, 11));
      done();
    };
  });
}
if (!Bun.isMainThread) postMessage("ran");
