console.log("the body of the file begins");
globalThis.hasBegun();
await new Promise(done => setTimeout(done, 400));
console.log("the body of the file goes on");
export const opening = "opening";
