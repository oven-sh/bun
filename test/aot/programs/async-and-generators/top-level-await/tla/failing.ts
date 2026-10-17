import { say } from "./log.ts"
say("failing starts")
await null
throw new Error("evaluation failed")
