// The name of each Worker's file goes through one more function of the library on its way to the constructor. A test run reads through it as the build of an
// executable does, and the Worker starts from its file.
import { test } from "bun:test";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath as pathOf } from "bun";

const base = import.meta.url;
const starts = [
  ["Bun.fileURLToPath() of a URL", () => new Worker(Bun.fileURLToPath(new URL("./w1.js", import.meta.url)))],
  ['fileURLToPath() of "bun"', () => new Worker(pathOf(new URL("./w2.js", import.meta.url)))],
  ["Bun.pathToFileURL()", () => new Worker(Bun.pathToFileURL(import.meta.dir + "/w3.js"))],
  ["URL.parse()", () => new Worker(URL.parse("./w4.js", import.meta.url))],
  ["URL.parse() from a constant that holds import.meta.url", () => new Worker(URL.parse("./w5.js", base))],
  ["path.normalize()", () => new Worker(normalize(join(import.meta.dir, "lib", "..", "w6.js")))],
  ["path.resolve() of one path", () => new Worker(resolve(join(import.meta.dir, "w7.js")))],
];

test("each Worker answers", async () => {
  for (const [how, start] of starts) {
    const worker = start();
    const answer = await new Promise(done => {
      worker.onmessage = event => done(event.data);
      worker.onerror = event => (event.preventDefault(), done("error"));
    });
    console.log(how + ": " + answer);
    worker.terminate();
  }
});
