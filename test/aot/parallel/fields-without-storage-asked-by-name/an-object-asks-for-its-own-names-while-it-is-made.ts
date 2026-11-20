// The order of the birth lists every name that the maker gives. An object that is still being made has those that it was given so far.
class Node {
  kind: string
  first?: unknown
  second?: unknown
  third?: unknown
  seen: string[] = []
  constructor(kind: string, which: number) {
    this.kind = kind
    this.look("start")
    if (which & 1) this.first = undefined
    this.look("one")
    if (which & 2) this.second = undefined
    this.look("two")
    if (which & 4) this.third = "t"
    this.look("three")
  }
  look(when: string) { this.seen.push(when + ":" + ("first" in this ? "f" : "-") + ("second" in this ? "s" : "-") + ("third" in this ? "t" : "-") + (Object.hasOwn(this, "second") ? "S" : "-")) }
}
function Plain(this: any, which: number) {
  this.kind = "plain"
  this.seen = [("late" in this) + "|" + ("later" in this)]
  this.late = undefined
  this.seen.push(("late" in this) + "|" + ("later" in this))
  if (which) this.later = undefined
  this.seen.push(("late" in this) + "|" + ("later" in this))
}
for (let round = 0; round < 3; round++) {
  for (let which = 0; which < 8; which++) console.log(round, which, new Node("n", which).seen.join(" "))
  console.log(round, new (Plain as any)(0).seen.join(" "), new (Plain as any)(1).seen.join(" "))
}
