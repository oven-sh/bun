globalThis.loads = (globalThis.loads ?? 0) + 1;
console.log("SAID config runs", globalThis.loads);
if (!globalThis.settings) throw new Error("not ready");
export const state = "ready " + globalThis.loads;
