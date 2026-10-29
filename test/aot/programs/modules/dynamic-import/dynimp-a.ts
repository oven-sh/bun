import { log } from "./dynimp-log.ts"
import { base } from "./dynimp-b.ts"
log("a evaluated")
export const value = base + 1
export function twice(n: number): number { return n * 2 }
