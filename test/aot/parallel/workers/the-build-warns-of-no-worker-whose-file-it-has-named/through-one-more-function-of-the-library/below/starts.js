import { Worker as Thread } from "node:worker_threads";
import { fileURLToPath as pathOf } from "bun";
const held = Bun.fileURLToPath(new URL("./held.js", import.meta.url));
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
  ["Bun.resolveSync()", () => new Worker(Bun.resolveSync("./found.js", import.meta.dir))],
  ["Bun.resolveSync(), no extension", () => new Worker(Bun.resolveSync("./found-short", import.meta.dir))],
  ["an awaited Bun.resolve()", async () => new Worker(await Bun.resolve("./awaited.js", import.meta.dir))],
  ["import.meta.resolveSync()", () => new Worker(import.meta.resolveSync("./found-from-file.js"))],
  [
    "require.resolve() with the own folder as its paths",
    () => new Worker(require.resolve("./found-by-paths.js", { paths: [import.meta.dir] })),
  ],
];
