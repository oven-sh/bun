// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { join } from "node:path";
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
const move = meta => {
  meta.dirname = join(meta.dirname, "absent");
};
move(import.meta);
console.log(await listen(new Worker(join(import.meta.dirname, "job.mjs"))));
