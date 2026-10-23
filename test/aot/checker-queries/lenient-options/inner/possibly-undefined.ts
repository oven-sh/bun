// What `strictNullChecks` only reports, and makes no type of, is asked of the file.
export function size(sizes: Map<string, { n: number }>, key: string): number { return sizes.get(key).n; }
export function later(flag: boolean): number { let n: number; if (flag) n = 1; return n; }
export function sign(n: number): number { if (n > 0) return 1; if (n < 0) return -1; }
export function pick(from: { a: number }) { return { a: 1, ...from }; }
