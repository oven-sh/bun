export interface O { n: number; f?: () => number }
export const withIt = (): O => ({ n: 1, f: () => 2 });
export const without = (): O => ({ n: 1 });
export const undefinedIt = (): O => ({ n: 1, f: undefined });
