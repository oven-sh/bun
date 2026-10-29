// A string constant that only rare code reads is found again by every later read, in a handler, behind a test that seldom holds and in a function that widens a literal type.
declare const console: { log(...args: unknown[]): void }
type Kind = "the first kind" | "the second kind"
function describe(value: number): string {
  if (value < 0) {
    try {
      if (value < -1) throw new Error("a message that only the rare path makes")
      return "a text that only the rare path reads"
    } catch (error) {
      return "a text that only the handler reads: " + (error as Error).message
    }
  }
  return "common"
}
function widen(kind: Kind, value: number): string | null {
  if (value < 0) return kind
  return null
}
const seen: string[] = []
for (let round = 0; round < 3; round++) {
  for (let value = 200; value >= -2; value--) {
    const text = describe(value)
    if (text !== "common") seen.push(text)
    const kind = widen(value % 2 ? "the first kind" : "the second kind", value)
    if (kind !== null) seen.push(kind + "!")
  }
}
console.log(seen.length, new Set(seen).size)
console.log(seen.join("|"))
console.log(seen[0] === seen[4], seen[1] === seen[5], seen[2] === seen[6], seen[3] === seen[7])
