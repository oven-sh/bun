export const get = () => "real";
console.log("| body begins");
globalThis.tellThatBodyHasBegun();
await new Promise(done => setTimeout(done, 20));
throw new Error("slow");
