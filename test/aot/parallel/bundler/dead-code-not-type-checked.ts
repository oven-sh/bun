// Code that a build-time constant cuts is not checked. Each call of `wrong` with a text is a type error, which stops the build unless the checker knows that the call never runs.
// Flags: --define process.env.APP_CHANNEL="public" --define INTERNAL=false --define PUBLIC=true --feature ON
// Reference: bun build --compile
import { feature } from "bun:bundle"
declare const INTERNAL: boolean
declare const PUBLIC: boolean
const log: unknown[] = []
function wrong(n: number): number {
  log.push("this ran: " + n)
  return n
}

log.push(process.env.APP_CHANNEL === "internal" ? wrong("an arm") : "public")
log.push(feature("OFF") ? wrong("a feature that is off") : "off")
log.push(INTERNAL && wrong("behind and"), PUBLIC || wrong("behind or"), process.env.APP_CHANNEL ?? wrong("behind ??"))
log.push(PUBLIC && "taken", INTERNAL || "taken too")

function returnsInDeadBranch() {
  if (process.env.APP_CHANNEL === "internal") return wrong("a branch")
  return "text"
}
function returnsEarly() {
  if (feature("ON")) return "early"
  return wrong("after a return")
}
function switches() {
  switch (process.env.APP_CHANNEL) {
    case "internal":
      return wrong("a case")
    case "public":
      return "public case"
    default:
      return wrong("the default")
  }
}
log.push(returnsInDeadBranch(), returnsEarly(), switches())

const isInternal = process.env.APP_CHANNEL === "internal"
log.push(isInternal ? wrong("through a constant") : "through a constant")
function throughLocal() {
  const found = process.env.APP_CHANNEL === "internal" ? { suffix: 1 } : undefined
  if (found) return wrong("through a local")
  return "through a local"
}
log.push(throughLocal())

function notTheFirstOperand(live: string) {
  return live && INTERNAL && wrong("the third operand")
}
function decidedThoughEvaluated(live: string) {
  return live && INTERNAL ? wrong("an arm") : "the other arm"
}
log.push(notTheFirstOperand("live"), decidedThoughEvaluated("live"))

function loops() {
  while (INTERNAL) wrong("a loop")
  for (; process.env.APP_CHANNEL === "internal"; ) wrong("another loop")
  return "no loop ran"
}
log.push(loops())

const STAGING = process.env.APP_CHANNEL === "internal" ? ({ host: "staging.example" } as const) : undefined
function host(): string {
  return STAGING ? STAGING.host + wrong("where the constant is an object") : "example.com"
}
log.push(STAGING, host(), STAGING?.host.notAMember)

const spread = { name: "spread", ...(INTERNAL && { secret: wrong("in a spread") }), ...(process.env.APP_CHANNEL === "internal" ? { other: wrong("in another") } : {}) }
log.push(...Object.keys(spread))

if (feature("OFF")) {
  const text: number = "not a number"
  log.push(text, missingName)
}
console.log(log.map(String).join("\n"))
