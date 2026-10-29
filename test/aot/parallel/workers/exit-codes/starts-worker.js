const worker = new Worker(new URL("./import-rejects.js", import.meta.url).href);
const heard = [];
worker.addEventListener("message", event => heard.push(event.data));
worker.addEventListener("error", event => heard.push(String(event.message).match(/^error: .*$/m)[0]));
worker.addEventListener("close", event => postMessage("inner worker: " + [...heard, "close " + event.code].join(", ")));
