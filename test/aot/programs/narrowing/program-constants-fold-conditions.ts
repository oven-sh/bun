// A `const` that holds a primitive literal decides the conditions it is tested in. The code that never runs is not checked: each call of `wrong` with a text is a type error. A read in the temporal dead zone still throws.
// A `const` that holds an object is checked on both sides, and the side for a falsy or missing object never runs.
const log: unknown[] = []
function readsEarly(): string {
  try {
    return late ? "yes" : "no"
  } catch (error) {
    return (error as Error).name
  }
}
function readsEarlyInAnd(): unknown {
  try {
    return late && "never"
  } catch (error) {
    return (error as Error).name
  }
}
function readsEarlyInIf(): string {
  try {
    if (late) return "never"
    return "no"
  } catch (error) {
    return (error as Error).name
  }
}
log.push(readsEarly(), readsEarlyInAnd(), readsEarlyInIf())
const late = false
log.push(readsEarly(), readsEarlyInAnd(), readsEarlyInIf())

function wrong(n: number): number {
  log.push("this ran: " + n)
  return n
}
const DEBUG = false
const picked = DEBUG ? wrong("an arm") : "quiet"
function describe() {
  if (DEBUG) return wrong("a branch")
  return "described"
}
const table = { a: 1 }
const always = table ? "an object is truthy" : wrong(1)
const present = table ?? { a: wrong(2) }
log.push(picked, describe(), always, present.a)

function loop(): string[] {
  const seen: string[] = []
  for (let i = 0; i < 3; i++) {
    const even = i % 2 === 0
    seen.push(even ? "even" : "odd")
  }
  return seen
}
log.push(...loop())
console.log(log.map(String).join("\n"))
