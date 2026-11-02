// A build-time constant decides a condition also where it comes through another module, a namespace import, an enum, or a function that returns it. No call of `wrong` runs: each would leave a line in the log.
// Flags: --define process.env.APP_CHANNEL="public" --feature ON
// Reference: bun build --compile
import { Channel, HAS_FEATURE, IS_INTERNAL, LEVEL, Level, calls, countsCalls, decidesInSteps, dependsOnItsArgument, hasFeature, isInternal, reassign, reassigned } from "./flags"
import * as flags from "./flags"
import { INTERNAL_AGAIN, isInternalAgain } from "./again"
const log: unknown[] = []
function wrong(n: string): string {
  log.push("this ran: " + n)
  return n
}

const imported = IS_INTERNAL ? wrong("imported") : "imported constant"
const importedFeature = HAS_FEATURE ? "imported feature" : wrong("importedFeature")
const throughNamespace = flags.IS_INTERNAL ? wrong("throughNamespace") : "through a namespace"
const exportedAgain = INTERNAL_AGAIN ? wrong("exportedAgain") : "exported again"
log.push(imported, importedFeature, throughNamespace, exportedAgain)

const called = isInternal() ? wrong("called") : "a function that returns a constant"
const calledArrow = hasFeature() ? "an arrow function that returns a constant" : wrong("calledArrow")
const calledAgain = isInternalAgain() ? wrong("calledAgain") : "a function exported again"
const steps = decidesInSteps() ? wrong("steps") : "a function that decides in steps"
log.push(called, calledArrow, calledAgain, steps)

const byEnum = LEVEL === Level.Quiet ? "an enum member" : wrong("byEnum")
const byArithmetic = Level.Louder === 2 ? "an enum member that is calculated" : wrong("byArithmetic")
const byConstEnum = process.env.APP_CHANNEL === Channel.Public ? "a const enum member" : wrong("byConstEnum")
log.push(byEnum, byArithmetic, byConstEnum)

const counted = countsCalls() ? wrong("counted") : "the call is still made"
log.push(counted, calls)
const open: string | number = dependsOnItsArgument(calls > 0) ? 13 : "not this one"
log.push(open)
log.push(reassigned ? "reassigned" : "not yet")
reassign()
log.push(reassigned ? "reassigned" : "not yet")
console.log(log.map(String).join("\n"))
