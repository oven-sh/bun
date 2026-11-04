export const make = () => { const o = { n: 1 }; o.me = () => o.me; o.get = () => o; return o; };
