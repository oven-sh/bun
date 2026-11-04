const E = {};
if (globalThis.neverSet) E.A = 0;
E.B = 1;
export const read = () => [String(E.A), E.B].join();
