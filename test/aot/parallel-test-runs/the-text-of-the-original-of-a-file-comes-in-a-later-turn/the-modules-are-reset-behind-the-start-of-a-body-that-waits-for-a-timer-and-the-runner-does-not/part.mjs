console.log("the body of the file begins");
globalThis.hasBegun();
// The run ends long before: where it does not, it waits for this timer.
await new Promise(done => setTimeout(done, 100_000));
console.log("the body of the file goes on");
export const opening = "opening";
