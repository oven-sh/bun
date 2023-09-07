// @runtime node, bun, deno
import { bench, run } from "./runner.mjs";
import { Buffer } from "node:buffer";
import { openSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { writeSync as write } from "node:fs";

bench("writeFile(/tmp/foo.txt, short string)", async () => {
  await writeFile("/tmp/foo.txt", "short string", "utf8");
});

const buffer = Buffer.from("short string");
bench("writeFile(/tmp/foo.txt, Buffer.from(short string))", async () => {
  await writeFile("/tmp/foo.txt", buffer);
});

const fd = openSync("/tmp/foo.txt", "w");

bench("write(fd, short string)", () => {
  const bytesWritten = write(fd, "short string", "utf8");
  if (bytesWritten !== 12) throw new Error("wrote !== 12");
});

bench("write(fd, Uint8Array(short string))", () => {
  const bytesWritten = write(fd, buffer);
  if (bytesWritten !== 12) throw new Error("wrote !== 12");
});

await run();
