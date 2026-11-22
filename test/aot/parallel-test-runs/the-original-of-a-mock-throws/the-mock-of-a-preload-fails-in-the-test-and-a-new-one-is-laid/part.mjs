globalThis.ran = (globalThis.ran ?? 0) + 1;
if (globalThis.ran === 1) throw new Error("part fails");
export const a = "real";
