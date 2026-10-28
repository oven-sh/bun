// The first use of a built-in may come in the handler of a stack overflow, and the host creates some built-ins by running JavaScript: process.nextTick sets up its queue. Plain Bun reports the RangeError of that set-up as uncaught, exits with 1 and leaves process.nextTick undefined. Compiled code has the built-in as a constant, so the run time keeps stack for its creation.
let handlers = 0;
let failedUses = 0;
function deep(depth) {
  try {
    return deep(depth + 1);
  } catch (error) {
    handlers++;
    try {
      process.nextTick(() => {});
      Buffer.from("a");
      structuredClone({});
      new TextDecoder().decode(new Uint8Array(1));
      queueMicrotask(() => {});
      new URL("http://a/");
      new AbortController().abort();
      performance.now();
    } catch {
      failedUses++;
    }
    throw error;
  }
}
try {
  deep(0);
} catch (error) {
  console.log(error.name);
}
console.log(handlers > 0, failedUses > 0, typeof process.nextTick, Buffer.from("ok").toString());
process.nextTick(() => console.log("tick"));
