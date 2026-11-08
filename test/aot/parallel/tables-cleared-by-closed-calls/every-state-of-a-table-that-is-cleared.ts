// A table without storage, one emptied by deletes, one that an iterator stands in, one of a subclass, one with a method of its own: each cleared by a closed call, and looked at behind it.
function clearAny(table: any): unknown { return table.clear() }
function show(name: string, table: Map<unknown, unknown> | Set<unknown>) { console.log(name, table.size, JSON.stringify([...table])) }
class Counting extends Map<string, number> { cleared = 0; override clear() { this.cleared++; super.clear() } }
for (let round = 0; round < 3; round++) {
  const never = new Map<string, number>()
  console.log(clearAny(never)); show("never filled", never); never.set("a", 1); show("filled behind it", never)

  const emptied = new Map<string, number>([["a", 1], ["b", 2]])
  emptied.delete("a"); emptied.delete("b")
  console.log(clearAny(emptied)); show("emptied by deletes", emptied); emptied.set("c", 3); emptied.set("a", 4); show("filled behind it", emptied)

  const walked = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]])
  const steps = walked.entries()
  console.log(JSON.stringify(steps.next()))
  walked.delete("a"); walked.delete("b"); walked.delete("c")
  console.log(clearAny(walked))
  walked.set("d", 4); walked.set("e", 5)
  console.log(JSON.stringify([...steps]))

  const walkedFull = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]])
  const stepsOfFull = walkedFull.keys()
  stepsOfFull.next()
  console.log(clearAny(walkedFull)); walkedFull.set("z", 26)
  console.log(JSON.stringify([...stepsOfFull]))

  const set = new Set<number>([1, 2, 3])
  const members = set.values()
  members.next(); set.delete(1); set.delete(2); set.delete(3)
  console.log(clearAny(set)); set.add(9)
  console.log(JSON.stringify([...members]), set.size)

  const counting = new Counting()
  clearAny(counting); counting.set("a", 1); clearAny(counting)
  console.log(counting.cleared, counting.size)

  const own = new Map<string, number>([["a", 1]])
  ;(own as any).clear = function () { return "own" }
  console.log(clearAny(own), own.size)

  const frozen = Object.freeze(new Map<string, number>())
  console.log(clearAny(frozen), frozen.size)
  for (const wrong of [new Set(), {}, [], 1, "text"]) {
    try { console.log(String(Map.prototype.clear.call(wrong as any))) } catch (error) { console.log((error as Error).constructor.name) }
  }
}
