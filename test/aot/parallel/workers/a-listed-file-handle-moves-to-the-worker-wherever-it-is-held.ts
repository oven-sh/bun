// A FileHandle in the transferList of a Worker moves to the worker wherever workerData or the environment data holds it, and what is marked uncloneable beside it is refused all the same.
import { open, type FileHandle } from "node:fs/promises";
import {
  getEnvironmentData,
  isMainThread,
  markAsUncloneable,
  parentPort,
  setEnvironmentData,
  Worker,
  workerData,
} from "node:worker_threads";

class Holder {
  constructor(public fh: unknown) {}
}

if (isMainThread) {
  const marked = {};
  markAsUncloneable(marked);
  const holders: [string, (fh: FileHandle) => unknown][] = [
    ["a plain object", fh => ({ fh })],
    ["a class instance", fh => new Holder(fh)],
    ["a Map", fh => new Map([["fh", fh]])],
    ["the environment data", fh => (setEnvironmentData("holder", new Holder(fh)), "in the environment data")],
    ["nothing", () => "nowhere"],
    ["an object beside one that is marked uncloneable", fh => ({ fh, marked })],
  ];
  for (const [name, hold] of holders) {
    const fh = await open(process.execPath, "r");
    try {
      const worker = new Worker(import.meta.filename, { workerData: hold(fh), transferList: [fh as never] });
      const said = await new Promise(resolve => worker.once("message", resolve));
      await worker.terminate();
      console.log(`held by ${name}: the worker ${said}, and the parent has descriptor ${fh.fd}`);
    } catch (error) {
      console.log(`held by ${name}: ${(error as Error).name}, and the parent still has it: ${fh.fd !== -1}`);
    } finally {
      setEnvironmentData("holder", undefined);
      if (fh.fd !== -1) await fh.close();
    }
  }
} else {
  const held: unknown =
    workerData === "nowhere"
      ? undefined
      : workerData === "in the environment data"
        ? (getEnvironmentData("holder") as Holder).fh
        : workerData instanceof Map
          ? workerData.get("fh")
          : workerData.fh;
  if (held === undefined) {
    parentPort!.postMessage("got no handle");
  } else if (typeof (held as FileHandle).read !== "function") {
    parentPort!.postMessage(`got an object with the keys ${Object.keys(held as object)}`);
  } else {
    const fh = held as FileHandle;
    const { bytesRead } = await fh.read(Buffer.alloc(4), 0, 4, 0);
    await fh.close();
    parentPort!.postMessage(`read ${bytesRead} bytes through a ${fh.constructor.name}`);
  }
}
