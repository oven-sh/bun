// @runtime node, bun, deno
import { Buffer } from "node:buffer";
import { openSync, writeSync as write } from "node:fs";
import { writeFile } from "node:fs/promises";
import { bench, run } from "./runner.mjs";

bench("writeFile(/tmp/foo.txt, short string)", async () => {
  await writeFile("/tmp/foo.txt", "short string", "utf8");
});

bench("writeFile(/tmp/foo.txt, Buffer.from(short string))", async () => {
  await writeFile("/tmp/foo.txt", Buffer.from("short string"));
});

const fd = openSync("/tmp/foo.txt", "w");

bench("write(fd, short string)", () => {
  const bytesWritten = write(fd, "short string", "utf8");
  if (bytesWritten !== 12) throw new Error("wrote !== 12");
});

bench("write(fd, Uint8Array(short string))", () => {
  const bytesWritten = write(fd, Buffer.from("short string"));
  if (bytesWritten !== 12) throw new Error("wrote !== 12");
});

await run();
