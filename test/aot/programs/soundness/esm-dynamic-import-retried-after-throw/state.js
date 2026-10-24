globalThis.runs = (globalThis.runs || 0) + 1;
globalThis.hook = () => later.x;
export const early = { x: globalThis.runs };
if (globalThis.runs === 1) throw new RangeError("first");
const later = { x: 1 };
export { later };
