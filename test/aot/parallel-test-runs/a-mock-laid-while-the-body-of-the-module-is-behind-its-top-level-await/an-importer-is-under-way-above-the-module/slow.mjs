export let state = "early";
export const get = () => "real " + state;
console.log("| body begins");
globalThis.tellThatBodyHasBegun();
await new Promise(done => setTimeout(done, 20));
state = "late";
console.log("| body ends");
