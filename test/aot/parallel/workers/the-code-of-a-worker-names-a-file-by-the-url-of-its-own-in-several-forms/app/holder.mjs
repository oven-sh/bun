const listen = (worker, form) =>
  new Promise(done => {
    worker.onmessage = event => (worker.terminate(), done(`beside the entry point, ${form}: ${event.data}`));
    worker.onerror = event => (
      event.preventDefault(),
      worker.terminate(),
      done(`beside the entry point, ${form}: error`)
    );
  });
const tell =
  'error => postMessage("threw " + [error.name, error.message, error.specifier, error.referrer].join(" | "))';
const climbs = 'import("' + import.meta.url + '/../climbs.mjs").then(job => postMessage(job.said), ' + tell + ")";
const folded =
  'import("' + new URL("./folded.mjs", import.meta.url) + '").then(job => postMessage(job.said), ' + tell + ")";
export const start = async () =>
  [
    await listen(new Worker("data:text/javascript," + encodeURIComponent(climbs)), "the URL of the file and /../"),
    await listen(new Worker("data:text/javascript," + encodeURIComponent(folded)), "new URL()"),
  ].join("\n");
