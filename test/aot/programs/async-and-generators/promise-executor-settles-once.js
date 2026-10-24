// The resolving functions of `new Promise(executor)` settle the promise once. Every later call, and a later throw from the executor, is ignored.
async function report(label, promise) {
  try {
    console.log(label, "fulfilled", await promise);
  } catch (error) {
    console.log(label, "rejected", error.message);
  }
}

async function runJobs() {
  for (let turn = 0; turn < 8; turn++) await undefined;
}

await report("resolve, resolve", new Promise(resolve => { resolve(1); resolve(2); }));
await report("resolve, reject", new Promise((resolve, reject) => { resolve(1); reject(new Error("late")); }));
await report("resolve, throw", new Promise(resolve => { resolve(1); throw new Error("late"); }));
await report("reject, resolve", new Promise((resolve, reject) => { reject(new Error("first")); resolve(2); }));
await report("reject, reject", new Promise((resolve, reject) => { reject(new Error("first")); reject(new Error("second")); }));
await report("reject, throw", new Promise((resolve, reject) => { reject(new Error("first")); throw new Error("late"); }));
await report("throw", new Promise(() => { throw new Error("only"); }));

let resolveLater;
const resolvedInExecutor = new Promise(resolve => { resolveLater = resolve; resolve(1); });
resolveLater(2);
await report("resolve, resolve after the executor returned", resolvedInExecutor);

let fulfillInner;
const inner = new Promise(resolve => { fulfillInner = resolve; });
let outcome = "pending";
new Promise((resolve, reject) => { resolve(inner); resolve(4); reject(new Error("late")); }).then(
  value => { outcome = "fulfilled " + value; },
  error => { outcome = "rejected " + error.message; },
);
await runJobs();
console.log("resolve with a pending promise, resolve, reject:", outcome);
fulfillInner(3);
await runJobs();
console.log("after the pending promise is fulfilled:", outcome);

new Promise((resolve, reject) => console.log("results", resolve(1), resolve(2), reject(new Error("late"))));
