import { write } from "bun";
import { openSync } from "fs";
import { bench, run } from "../runner.mjs";

bench('write(/tmp/foo.txt, "short string")', async () => {
  await write("/tmp/foo.txt", "short string");
});

const buffer = Buffer.from("short string");
bench('write(/tmp/foo.txt, Buffer.from("short string"))', async () => {
  await write("/tmp/foo.txt", buffer);
});

const fd = openSync("/tmp/foo.txt", "w");

bench('write(fd, "short string")', async () => {
  await write(fd, "short string");
});

bench('write(fd, Buffer.from("short string"))', async () => {
  await write(fd, buffer);
});

await run();
