import { createReadStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { sep } from "node:path";
import { bench, run } from "./runner.mjs";

if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const ALLOW_BUN = typeof Bun !== "undefined";
const ALLOW_NODE = true;

const dir = tmpdir() + sep;

var short = (function () {
  const text = "Hello World!";
  const path = dir + "bun-bench-short.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();
var shortUTF16 = (function () {
  const text = "Hello World 💕💕💕";
  const path = dir + "bun-bench-shortUTF16.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();
var long = (function () {
  const text = "Hello World!".repeat(1024);
  const path = dir + "bun-bench-long.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();
var longUTF16 = (function () {
  const text = "Hello World 💕💕💕".repeat(15 * 70192);
  const path = dir + "bun-bench-longUTF16.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();

async function bun(path) {
  for await (const chunk of Bun.file(path).stream()) {
    chunk;
  }
}

async function node(path) {
  const { promise, resolve } = Promise.withResolvers();
  const stream = createReadStream(path);
  stream.on("data", chunk => {});
  stream.on("end", () => resolve());
  await promise;
}

ALLOW_BUN && bench("short - bun", () => bun(short.path));
ALLOW_NODE && bench("short - node", () => node(short.path));

ALLOW_BUN && bench("shortUTF16 - bun", () => bun(shortUTF16.path));
ALLOW_NODE && bench("shortUTF16 - node", () => node(shortUTF16.path));

ALLOW_BUN && bench("long - bun", () => bun(long.path));
ALLOW_NODE && bench("long - node", () => node(long.path));

ALLOW_BUN && bench("longUTF16 - bun", () => bun(longUTF16.path));
ALLOW_NODE && bench("longUTF16 - node", () => node(longUTF16.path));

await run();
