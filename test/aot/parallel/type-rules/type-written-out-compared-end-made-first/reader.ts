import type { Box, Crate } from "./shared";
type Repeat<N extends number, M, A extends unknown[] = []> = A["length"] extends N ? A : Repeat<N, M, [...A, M]>;
export function depth(x: Box<[[[number]]]>): unknown { return x.v; }
export function convert(b: Box<number>): Crate<number> { return b; }
