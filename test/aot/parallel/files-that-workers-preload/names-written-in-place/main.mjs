// A file that stands under `preload` is compiled and loaded where its name is written from the folder of the program.
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = event => {
      event.preventDefault();
      resolve("fails: " + event.message);
    };
  });
}

const require = createRequire(import.meta.url);
const job = new URL("./job.mjs", import.meta.url);
const url = new URL("./url.mjs", import.meta.url);
const held = fileURLToPath(new URL("./held.mjs", import.meta.url));
const list = new Worker(job, {
  preload: [
    new URL("./href.mjs", import.meta.url).href,
    url,
    held,
    join(import.meta.dir, "joined.mjs"),
    resolve(import.meta.dirname, "resolved.mjs"),
    import.meta.dir + "/sum.mjs",
    `${import.meta.dir}/template.mjs`,
    import.meta.resolve("./answered.mjs"),
    require.resolve("./required.mjs"),
    ...(process.argv.length > 99 ? [] : [join(import.meta.dir, "spread.mjs")]),
  ],
});
console.log("a list:", await listen(list));
console.log("a name:", await listen(new Worker(job, { preload: held })));
const options = { name: "job", preload: url.href };
console.log("options:", await listen(new Worker(job, options)));
