// A function starts a Worker from a name whose `--define` value is the `href` of a parameter that it takes out of an object, and is passed an object with a URL: the build compiles the file.
// Flags: --define HREF=url.href
const start = ({ url }) => new Worker(HREF);
const worker = start({ url: new URL("./w.mjs", import.meta.url) });
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
