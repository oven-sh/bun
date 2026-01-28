// `fish -c "bun run watch 2>&1 | bun scripts/cleartrace"`

import { createInterface } from "node:readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let chunk: string[] = [];
rl.on("line", line => {
  chunk.push(line);
});
let timeout: NodeJS.Timeout | null = null;
async function doNow() {
  if (timeout != null) {
    clearTimeout(timeout);
    timeout = null;
  }
  const eatChunk = chunk;
  chunk = [];
  if (eatChunk.length > 0) {
    const proc = Bun.spawn({
      cmd: ["bun", "scripts/cleartrace-impl.js"],
      stdio: ["pipe", "inherit", "inherit"],
    });
    proc.stdin.write(eatChunk.join("\n"));
    proc.stdin.end();
    await proc.exited;
  }
  enqueue();
}
let ceaseTimeout = false;
function enqueue() {
  if (ceaseTimeout) return;
  timeout = setTimeout(() => {
    timeout = null;
    doNow();
  }, 100);
}
enqueue();

rl.on("close", () => {
  ceaseTimeout = true;
});
