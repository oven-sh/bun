export let state = "early"; export const get = () => "real " + state;
globalThis.tellThatBodyHasBegun?.(); await new Promise(done => setTimeout(done, 20)); state = "late";
