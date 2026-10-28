import { say } from "./log.ts"
import { value } from "./slow.ts"
import { q } from "./quick.ts"
import { p } from "./plain.ts"
say("parent " + value + q + p)
export const all = value + q + p
