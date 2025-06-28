import { existsSync, mkdirSync, promises } from "node:fs";
import { tmpdir } from "node:os";
const count = 1024 * 12;

var queue = new Array(count);
var paths = new Array(count);
for (let i = 0; i < count; i++) {
  const path = `${tmpdir()}/${Date.now()}.rm.dir${i}`;
  try {
    mkdirSync(path);
  } catch (e) {}
  paths[i] = path;
  queue[i] = promises.rmdir(path);
}

await Promise.all(queue);

for (let i = 0; i < count; i++) {
  if (existsSync(paths[i])) {
    throw new Error(`Path ${paths[i]} was not removed`);
  }
}
