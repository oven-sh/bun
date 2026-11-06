// The program marks one object as untransferable and another as uncloneable, then sets environment data. A worker started afterwards reads the data.
// Flags: --aot-validate
import { Worker, isMainThread, parentPort, getEnvironmentData, setEnvironmentData, markAsUntransferable, markAsUncloneable } from "node:worker_threads";
if (isMainThread) {
  setEnvironmentData("before", 1);
  const pinned = new ArrayBuffer(4);
  markAsUntransferable(pinned);
  setEnvironmentData("pinned", { pinned });
  markAsUncloneable({});
  setEnvironmentData("after", { a: 2 });
  console.log("here", getEnvironmentData("before"), getEnvironmentData("pinned").pinned.byteLength, getEnvironmentData("after").a);
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", message => console.log("there", message));
  worker.on("error", error => console.log("error", error.name));
} else {
  parentPort.postMessage([getEnvironmentData("before"), getEnvironmentData("pinned")?.pinned?.byteLength, getEnvironmentData("after")?.a].join(" "));
}
