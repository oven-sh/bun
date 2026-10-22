import { fromB, keptInB } from "./cycle-b.ts";
export function make(tag: string): { tag: string } {
  return { tag };
}
export const early = fromB();
export function readLate(): string {
  return keptInB.map(k => k.tag).join();
}
