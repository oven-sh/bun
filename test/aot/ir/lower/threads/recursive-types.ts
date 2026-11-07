// RUN(ONE): link
// OPTIONS(ONE): threads=1
// RUN(T8A): link
// OPTIONS(T8A): threads=8
// SAME: ONE T8A
// RUN(T8B): link
// OPTIONS(T8B): threads=8
// SAME: ONE T8B
// RUN(T8C): link
// OPTIONS(T8C): threads=8
// SAME: ONE T8C
// RUN(T8D): link
// OPTIONS(T8D): threads=8
// SAME: ONE T8D
// RUN(T16A): link
// OPTIONS(T16A): threads=16
// SAME: ONE T16A
// RUN(T16B): link
// OPTIONS(T16B): threads=16
// SAME: ONE T16B
// RUN(T16C): link
// OPTIONS(T16C): threads=16
// SAME: ONE T16C
// RUN(T16D): link
// OPTIONS(T16D): threads=16
// SAME: ONE T16D

// `Box<T>` holds a `Box<[T]>`: a family of types that never ends, which the compiler follows for a few steps. One file writes `Box<[[[number]]]>` out, another makes the same type by instantiation, and which of the two threads comes first differs from run to run. How far the family is followed does not.

// FILE: main.ts
import { convert, depth } from "./compared";
import { other } from "./instantiated";
declare const console: { log(...values: unknown[]): void };
const deep = { v: [[[1]]] as [[[number]]], next: null };
console.log(depth(deep), other({ make: () => deep }), convert({ v: 1, next: null }).v);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"types":[]}}

// FILE: shared.ts
export interface Box<T> { v: T; next: Box<[T]> | null }
export interface Crate<T> { v: T; next: Crate<[T]> | null }

// FILE: compared.ts
import type { Box, Crate } from "./shared";
type Repeat<N extends number, M, A extends unknown[] = []> = A["length"] extends N ? A : Repeat<N, M, [...A, M]>;
export type Work0 = Repeat<900, 0>;
export type Work1 = Repeat<900, 1>;
export type Work2 = Repeat<900, 2>;
export type Work3 = Repeat<900, 3>;
export type Work4 = Repeat<900, 4>;
export type Work5 = Repeat<900, 5>;
export type Work6 = Repeat<900, 6>;
export type Work7 = Repeat<900, 7>;
export type Work8 = Repeat<900, 8>;
export type Work9 = Repeat<900, 9>;
export function depth(x: Box<[[[number]]]>): unknown { return x.v; }
export function convert(b: Box<number>): Crate<number> { return b; }

// FILE: instantiated.ts
import type { Box } from "./shared";
interface Maker<T> { make(): Box<[[[T]]]> }
export function other(maker: Maker<number>): unknown { return maker.make().v; }
