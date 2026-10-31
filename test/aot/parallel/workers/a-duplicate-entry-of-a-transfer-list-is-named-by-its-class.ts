// The message for a duplicate entry of a transfer list names the entry from native code, which reads the prototype object of each class above the entry. Nothing has asked the prototype objects of these two classes for a property before.
import { open } from "node:fs/promises";
import { Worker } from "node:worker_threads";

function duplicate(label: string, item: object) {
  try {
    new Worker(process.execPath, { workerData: {}, transferList: [item, item] as never });
    console.log(`${label}: no error`);
  } catch (error) {
    console.log(`${label}: ${(error as Error).name}: ${(error as Error).message}`);
  }
}

const handle = await open(process.execPath, "r");
const FileHandle = Object.getPrototypeOf(handle).constructor as new () => object;
class Sub extends FileHandle {}
class Leaf extends Sub {}
duplicate("a file handle", handle);
Object.setPrototypeOf(handle, Sub.prototype);
duplicate("a file handle below the prototype object of a class", handle);
Object.setPrototypeOf(handle, Leaf.prototype);
duplicate("a file handle below the prototype objects of two classes", handle);
Object.defineProperty(handle, Symbol.toStringTag, { value: "Tagged", configurable: true });
duplicate("a file handle with a tag of its own", handle);
Object.setPrototypeOf(handle, FileHandle.prototype);
await handle.close();
