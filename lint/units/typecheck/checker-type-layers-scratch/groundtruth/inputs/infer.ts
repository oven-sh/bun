type Two<T> = T extends [infer A, infer B, infer C, infer D] ? { a: A; b: B; c: C; d: D } : never;
type R = Two<[1, "x", true, null]>;
const r: R = 0;
interface I { [k: string]: unknown; ["lit"]: number; m(): void; n: string; o: boolean }
const s: I = 1;
