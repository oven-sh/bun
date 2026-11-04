export interface O { n: number; f: (() => number) | null }
export const make = (k: number): O => ({ n: k, f: k ? () => k : null });
