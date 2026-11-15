import { orNothing } from "./deep/more.ts";
export function first(list: number[]): number { return orNothing(list.length, list[0]); }
