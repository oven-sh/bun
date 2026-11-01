export interface O { n: number; f: (() => number) | number }
export const make = (k: number): O => ({ n: k, f: k ? () => k : 7 });
