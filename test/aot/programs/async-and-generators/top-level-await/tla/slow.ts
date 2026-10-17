import { say } from "./log.ts"
say("slow starts")
export const value = await new Promise<number>(resolve => setTimeout(() => resolve(42), 1))
say("slow done")
