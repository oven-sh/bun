globalThis.bodies = (globalThis.bodies ?? 0) + 1;
if (globalThis.bodies === 1) throw new Error("wick fails");
export const width = "real";
