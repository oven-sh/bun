globalThis.doughRan = (globalThis.doughRan ?? 0) + 1;
if (globalThis.doughRan === 1) throw new Error("the dough fell");
export const dough = "real dough";
