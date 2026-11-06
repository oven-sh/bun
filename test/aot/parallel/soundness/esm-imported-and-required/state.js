let c = 0;
class K { static s = 0; }
const sym = Symbol("s");
const obj = { n: 0 };
globalThis.runs = (globalThis.runs || 0) + 1;
export const inc = () => ++c;
export { K, sym, obj };
export const id = globalThis.runs;
