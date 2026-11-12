// An ES module that is no entry point starts itself as a worker: by the path in its own URL, and by a URL object made of that URL.
import { byPath, byUrl } from "./lib/own.mjs";
for (const [way, start] of [["the path in the own URL", byPath], ["a URL made of the own URL", byUrl]]) {
  const said = await new Promise(resolve => {
    const worker = start();
    worker.on("message", text => { resolve(text); worker.terminate(); });
    worker.on("error", error => resolve("error " + String(error.message).split("\n")[0].slice(0, 12)));
  });
  console.log(way + ":", said);
}
