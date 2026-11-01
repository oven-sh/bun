let v;
for (let i = 0; i < (globalThis.neverSet ? 1 : 0); i++) v = () => 1;
export const read = () => v;
