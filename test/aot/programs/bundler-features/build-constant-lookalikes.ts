// What only looks like a build-time constant decides nothing: a local of the same name, a variable that is assigned to, a function named `feature` that is not the bundler's.
const log: unknown[] = []
function shadowed(process: { env: { APP_CHANNEL: string } }) {
  return process.env.APP_CHANNEL === "internal" ? 1 : "public"
}
const either: number | string = shadowed({ env: { APP_CHANNEL: "internal" } })
log.push(either, shadowed({ env: { APP_CHANNEL: "public" } }))

function feature(name: string): boolean {
  return name === "OFF"
}
log.push(feature("OFF") ? "own function says on" : "off", feature("ON") ? "on" : "own function says off")

let channel = process.env.APP_CHANNEL === "internal"
function flip() {
  channel = !channel
}
log.push(channel ? "internal" : "public")
flip()
log.push(channel ? "internal" : "public")

function perCall(flag: boolean) {
  const local = flag
  return local ? "yes" : "no"
}
log.push(perCall(true), perCall(false))

const other = process.env.OTHER_CHANNEL === "internal" ? "internal" : "not defined by the build"
log.push(other)

function effects(): string[] {
  const seen: string[] = []
  const note = (text: string) => (seen.push(text), text)
  const first = note("left of and") && process.env.APP_CHANNEL === "internal" && note("never")
  const second = note("") || process.env.APP_CHANNEL === "public" || note("never")
  const third = (note("test"), process.env.APP_CHANNEL === "internal") ? note("never") : note("other arm")
  if (note("in if") && process.env.APP_CHANNEL === "internal") note("never")
  seen.push(String(first), String(second), String(third))
  return seen
}
log.push(...effects())
console.log(log.map(String).join("\n"))
