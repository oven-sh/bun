export const make = () => { const other = { n: 7 }; return { n: 1, get: () => other.n }; };
