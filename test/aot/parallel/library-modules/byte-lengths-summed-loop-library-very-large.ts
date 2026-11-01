// The writer of a file handle sums `buffers[i].byteLength` in a loop of the library. Built as a very large program, in which that loop is cold and gets its type tests late:
// the read by name is not split into one that asks only the tables of the run time and one that runs code, since a getter of Uint8Array answers it.
// Flags: --aot-limit=MaxWarmCodeValues:1
import { readFileSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const path = join(tmpdir(), `byte-lengths-summed-${process.pid}.bin`);
const file = await open(path, "w");
const writer = file.writer();
await writer.writev([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array(0), Buffer.from("six")]);
await writer.end();
await file.close().catch(() => {});
console.log(readFileSync(path).join(","));
rmSync(path);
