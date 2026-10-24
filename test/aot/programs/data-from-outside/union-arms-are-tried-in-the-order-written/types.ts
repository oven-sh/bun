import type { Schema } from "bun";
export type Zed = { a: number; by: string & Schema.Default<"Zed"> };
export type Abe = { a: number; by: string & Schema.Default<"Abe"> };
export type ZedThenAbe = Zed | Abe;
export type AbeThenZed = Abe | Zed;
export interface Holder<T> {
  held: T | Abe;
}
