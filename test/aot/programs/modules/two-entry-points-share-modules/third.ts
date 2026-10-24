import { log } from "./first";
let calls = 0;
export function total(n: number): number {
  return n * 10 + ++calls;
}
log("third is evaluated");
