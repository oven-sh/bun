export const make = () => { const other = { n: 7 }; const o = { n: 1 }; o.get = () => other.n; return o; };
