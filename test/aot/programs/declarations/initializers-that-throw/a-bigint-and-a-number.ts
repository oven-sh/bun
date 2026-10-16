function sum(a: bigint, b: number): { v: unknown } { return { v: (a as unknown as number) + b }; }
export const made = sum(1n, 1);
