globalThis.ran = (globalThis.ran ?? 0) + 1;
export const early = "early";
await new Promise(done => setTimeout(done, 40));
throw new RangeError("thrown late");
export const late = "late";
