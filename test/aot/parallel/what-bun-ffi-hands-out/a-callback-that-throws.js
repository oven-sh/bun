// What a callback throws comes out of the function of native code that has entered it.
import { CFunction, JSCallback } from "bun:ffi";
process.on("uncaughtException", error => console.log("caught at the top:", error.name, error.message));
const failing = new JSCallback(
  value => {
    throw new RangeError(`no ${value}`);
  },
  { args: ["i32"], returns: "i32" },
);
const enter = CFunction({ ptr: failing.ptr, args: ["i32"], returns: "i32" });
try {
  console.log("answered", String(enter(7)));
} catch (error) {
  console.log("thrown", error.name, error.message);
}
console.log("behind it");
