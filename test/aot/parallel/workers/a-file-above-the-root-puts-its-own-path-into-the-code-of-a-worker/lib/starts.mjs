const file = import.meta.dirname + "/job.mjs";
const code = 'import("' + file + '").then(job => postMessage(job.said), error => postMessage("threw " + error.name))';
const wait = worker =>
  new Promise(done => {
    worker.onmessage = event => (worker.terminate(), done("said " + event.data));
    worker.onerror = event => (event.preventDefault(), worker.terminate(), done("error"));
  });
export const startFromDataUrl = () => wait(new Worker("data:text/javascript," + encodeURIComponent(code)));
export const startFromBlob = () =>
  wait(new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" }))));
