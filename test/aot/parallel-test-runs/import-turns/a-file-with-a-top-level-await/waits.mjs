console.log("the file begins behind", globalThis.jobs, "jobs");
queueMicrotask(() => console.log("a job of the file"));
await null;
console.log("the file goes on");
await new Promise(done => setTimeout(done, 5));
let row = Promise.resolve();
for (let i = 0; i < 40; i++) row = row.then(() => void globalThis.jobsBehindTheFile++);
console.log("the file ends");
export const value = "behind the awaits";
