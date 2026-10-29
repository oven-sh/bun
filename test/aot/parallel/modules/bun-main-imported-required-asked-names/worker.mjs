import * as early from "bun:main";
import { parentPort } from "node:worker_threads";
const loadLater = async () => {
  await 0;
  const late = await import("bun:main");
  parentPort.postMessage(
    [typeof early, Object.keys(early).length, late === early, require("bun:main") === early].join(" "),
  );
};
loadLater();
