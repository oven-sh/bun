import { join, normalize, resolve } from "node:path";
import { Worker as Thread } from "node:worker_threads";
import { fileURLToPath as pathOf } from "bun";
const held = Bun.fileURLToPath(new URL("./held.js", import.meta.url));
const base = import.meta.url;
export const starts = [
  ["Bun.fileURLToPath() of a URL", () => new Worker(Bun.fileURLToPath(new URL("./path-of-url.js", import.meta.url)))],
  ["the same, held in a constant", () => new Worker(held)],
  [
    "the same, for the Worker of node:worker_threads",
    () => new Thread(Bun.fileURLToPath(new URL("./of-node.js", import.meta.url))),
  ],
  ['fileURLToPath() of "bun"', () => new Worker(pathOf(new URL("./of-module.js", import.meta.url)))],
  [
    "Bun.fileURLToPath() of import.meta.resolve()",
    () => new Worker(Bun.fileURLToPath(import.meta.resolve("./path-of-text.js"))),
  ],
  ["Bun.pathToFileURL()", () => new Worker(Bun.pathToFileURL(import.meta.dir + "/url-of-path.js"))],
  ["URL.parse()", () => new Worker(URL.parse("./parsed.js", import.meta.url))],
  ["URL.parse() from a constant that holds import.meta.url", () => new Worker(URL.parse("./parsed-from.js", base))],
  ["a URL made again by URL.parse()", () => new Worker(URL.parse(new URL("./parsed-again.js", import.meta.url)))],
  ["path.normalize()", () => new Worker(normalize(join(import.meta.dir, "lib", "..", "normalized.js")))],
  ["path.resolve() of one path", () => new Worker(resolve(join(import.meta.dir, "resolved.js")))],
];
