export const make = () => { let k = 1; const o = { n: 1, get: () => k, set: v => { k = v; } }; k = 2; return o; };
