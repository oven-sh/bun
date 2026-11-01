export interface O { n: number; f: () => number }
export const make = (x: unknown): O => ({ n: 1, f: x as () => number });
