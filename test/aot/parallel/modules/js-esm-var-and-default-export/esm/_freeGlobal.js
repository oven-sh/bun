var freeGlobal = typeof globalThis == 'object' && globalThis && globalThis.Object === Object && globalThis;
export default freeGlobal;
