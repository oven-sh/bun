let c = 0;
class K { static s = 0; }
const sym = Symbol("s");
const obj = { n: 0 };
globalThis.runs = (globalThis.runs || 0) + 1;
module.exports = { inc: () => ++c, K, sym, obj, id: globalThis.runs };
