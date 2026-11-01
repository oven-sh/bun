export const make = () => { const o = { n: 1 }; o.get = () => o.n; o.set = v => { o.n = v; }; return o; };
