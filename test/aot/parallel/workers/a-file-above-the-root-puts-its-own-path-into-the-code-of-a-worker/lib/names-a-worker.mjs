const code =
  'const inner = new Worker("' +
  import.meta.url +
  '/../posts.mjs"); inner.onmessage = event => postMessage(event.data); inner.onerror = () => postMessage("error inside");';
export const start = () =>
  new Promise(done => {
    const worker = new Worker("data:text/javascript," + encodeURIComponent(code));
    worker.onmessage = event => (worker.terminate(), done("said " + event.data));
    worker.onerror = event => (event.preventDefault(), worker.terminate(), done("error outside"));
  });
