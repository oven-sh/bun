// Calls functions of node:zlib and node:stream that one function expression makes under many names, with arguments they refuse, and prints the names in the stack frames of each error.
import { Readable } from "node:stream";
import zlib from "node:zlib";

const namesIn = error =>
  String(error?.stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ ?\(.*\)$/, "")
        .replace(/^.*[\\/].*$/, "<file>"),
    )
    .join(" < ");

function attempt(label, call) {
  try {
    call();
    console.log(label, "| nothing thrown");
  } catch (error) {
    console.log(label, "|", error?.code, "|", namesIn(error));
  }
}

async function attemptAndWait(label, call) {
  try {
    await call();
    console.log(label, "| nothing thrown");
  } catch (error) {
    console.log(label, "|", error?.code, "|", namesIn(error));
  }
}

for (const name of [
  "gzipSync",
  "deflateSync",
  "inflateSync",
  "gunzipSync",
  "brotliCompressSync",
  "unzipSync",
  "deflateRawSync",
  "zstdCompressSync",
]) {
  attempt(name, () => zlib[name](1));
  attempt(`${name}, no buffer`, () => {
    const made = zlib[name];
    return made();
  });
}
for (const name of ["gzip", "deflate", "inflate", "gunzip", "brotliCompress", "unzip"]) {
  attempt(name, () => zlib[name](1, () => {}));
  attempt(`${name}, no callback`, () => zlib[name]("text"));
}
for (const name of ["map", "filter", "flatMap", "drop", "take", "asIndexedPairs", "compose"]) {
  attempt(name, () => Readable.from([1])[name](1n));
  attempt(`new ${name}`, () => new (Readable.from([1])[name])(1));
}
for (const name of ["forEach", "some", "every", "find", "reduce"]) {
  attempt(`new ${name}`, () => new (Readable.from([1])[name])(1));
  await attemptAndWait(name, () => Readable.from([1])[name](1n));
}
