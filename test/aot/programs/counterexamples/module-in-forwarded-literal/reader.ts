import type { Api } from "./api.ts";
export async function reader<T>(first: T, n: number, ctx: { api: Api | null; a: number; b: number; c: string; d: boolean; e: number; g: number; h: number; i: number; j: number }): Promise<string> {
  return String(first) + " " + ctx.api?.f(n) + " " + ctx.j;
}
