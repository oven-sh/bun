export interface O { n: number; f?: () => number }
export const make = (add: boolean): O => { const o: O = { n: 1 }; if (add) o.f = () => o.n; return o; };
