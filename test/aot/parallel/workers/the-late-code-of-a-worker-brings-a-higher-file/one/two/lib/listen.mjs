export const listen = worker =>
  new Promise(done => {
    worker.onmessage = event => (worker.terminate(), done(event.data));
    worker.onerror = event => (event.preventDefault(), worker.terminate(), done("error"));
  });
