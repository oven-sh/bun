// A file of the ring imports a file that is not there, so the graph of the first call is never linked. The second call, which waited for it, is made again and fails the same way.
const first = import("./a.mjs");
await null;
const results = await Promise.allSettled([first, import("./b.mjs")]);
console.log(results.map(result => result.status + " " + (result.reason?.name ?? "")).join(" | "));
