// The functions are hoisted and called in front of the stores: each read throws a ReferenceError there. Behind the stores the same functions give the numbers. A method of a class that stands at the head of the file does the same.
const seen: string[] = []
function tryAll(when: string): void {
  for (const [name, read] of [["first", first], ["twice", twice], ["index", index], ["flag", flag], ["method", () => new Box().limit()], ["behind", behind]] as [string, () => unknown][]) {
    try { seen.push(when + " " + name + " " + String(read())) } catch (e) { seen.push(when + " " + name + " " + (e as Error).constructor.name) }
  }
}
function first(): number { return LIMIT }
function twice(): number { return LIMIT + LIMIT }
function index(): number { return [10, 20, 30][PLACE]! }
function flag(): string { return OPEN ? "open" : "shut" }
function behind(): number {
  let sum = 0
  try { sum += LIMIT } catch { sum -= 1000 }
  return sum + EARLY
}
export class Box {
  limit(): number { return LIMIT * 2 + PLACE }
}
const EARLY = 7
;(globalThis as any).tryAll = tryAll
;(globalThis as any).tryAll("in front")
const LIMIT = 300
;(globalThis as any).tryAll("between")
const PLACE = 2
const OPEN = true
;(globalThis as any).tryAll("behind")
console.log(seen.join("\n"))
