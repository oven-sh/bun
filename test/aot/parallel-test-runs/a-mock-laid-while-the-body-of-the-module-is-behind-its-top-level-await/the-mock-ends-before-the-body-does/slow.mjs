export let state = "early";
export const get = () => "real " + state;
console.log("| body begins");
globalThis.tellThatBodyHasBegun();
await globalThis.gate;
state = "late";
console.log("| body ends");
