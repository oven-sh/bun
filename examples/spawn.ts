import { readableStreamToText } from "bun";
import { spawn } from "bun";

const proc = spawn({
  cmd: ["ls", "-l"],

  // Both of these forms work:

  // as an array:
  stdio: ["ignore", "pipe", "ignore"],

  // You can also use "inherit" to inherit the parent's stdio.
  // stdin: "inherit",

  // You can pass a Bun.file to save it to a file:
  // stdout: Bun.file("/tmp/stdout.txt"),
});

const result = await readableStreamToText(proc.stdout);

await proc.exitStatus;

console.log(result);
