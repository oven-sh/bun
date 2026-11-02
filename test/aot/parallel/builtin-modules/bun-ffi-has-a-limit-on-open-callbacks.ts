// The entry points of callbacks are in the executable, so there is a limit on how many are open at a time. One that is closed gives its entry point back.
import { FFIType, JSCallback } from "bun:ffi";

const open: { close(): void }[] = [];
let refused = "";
for (let i = 0; i < 300 && !refused; i++) {
  try {
    open.push(new JSCallback(() => i, { args: [], returns: FFIType.i32 }));
  } catch (error) {
    refused = `${(error as Error).name}: ${(error as Error).message}`;
  }
}
console.log(open.length, refused);
open.pop()!.close();
open.push(new JSCallback(() => 1, { args: [], returns: FFIType.i32 }));
console.log(open.length);
for (const callback of open) callback.close();
/* Output:
256 RangeError: bun:ffi: a compiled executable can have 256 JSCallbacks open at a time. Close the ones that are no longer used
256
*/
