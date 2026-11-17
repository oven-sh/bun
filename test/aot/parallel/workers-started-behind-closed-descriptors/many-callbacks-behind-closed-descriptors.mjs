// More callbacks than one block of entries holds: each further block is mapped out of the executable's file.
import fs from "node:fs";
import { JSCallback, CFunction } from "bun:ffi";
function closeWhatNamesTheExecutable() {
  try {
    const own = fs.readlinkSync("/proc/self/exe");
    for (const name of fs.readdirSync("/proc/self/fd")) {
      let target = "";
      try { target = fs.readlinkSync("/proc/self/fd/" + name); } catch {}
      if (target === own) fs.closeSync(Number(name));
    }
  } catch {}
}
const callbacks = [];
function make(count) { for (let i = 0; i < count; i++) { const n = callbacks.length; callbacks.push(new JSCallback(() => n, { returns: "int32_t", args: [] })); } }
make(10);
closeWhatNamesTheExecutable();
let failed = "";
try { make(5000); } catch (error) { failed = error.name; }
let sum = 0;
for (const callback of callbacks) sum += CFunction({ ptr: callback.ptr, returns: "int32_t", args: [] })();
console.log(callbacks.length, sum, failed);
