// The program of generators-stepped-right-after-their-creation.ts, built without the pass that merges a loop with the body of its generator: the generators are made and stepped,
// as they are in a program where nothing proves that the prototypes of generators stay as they are. The first step calls the body, and a body that never yields saves no frame.
const log: string[] = []
function flush(): string {
  return log.splice(0).join(" ")
}
function* never(label: string): Generator<number> {
  log.push("body " + label)
}
function* once(label: string, value: number): Generator<number, string> {
  log.push("start " + label)
  try {
    yield value
    log.push("resumed " + label)
  } finally {
    log.push("finally " + label)
  }
  return "end"
}
function* count(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i
}
function* withDefault(a: number = (log.push("default"), 7)): Generator<number> {
  log.push("body")
  yield a
}
function* throwing(when: number): Generator<number> {
  if (when === 0) throw new RangeError("at start")
  yield 1
  if (when === 1) throw new RangeError("after one")
  yield 2
}
function* nested(depth: number): Generator<number> {
  if (depth > 0) yield* nested(depth - 1)
  yield depth
}
function* filtered(items: readonly number[], wanted: (item: number) => boolean): Generator<number> {
  for (const item of items) if (wanted(item)) yield item
}
function firstOrUndefined<T>(iterable: Iterable<T>): T | undefined {
  for (const value of iterable) return value
  return undefined
}
function firstOdd(items: readonly number[]): number | undefined {
  return firstOrUndefined(filtered(items, item => item % 2 === 1))
}
function attempt(action: () => unknown): string {
  try {
    return String(action())
  } catch (error) {
    return (error as Error).constructor.name + ":" + (error as Error).message
  }
}

function loops(): void {
  for (const value of never("a")) log.push("value " + value)
  console.log(flush())
  for (const value of once("b", 5)) log.push("value " + value)
  console.log(flush())
  for (const value of once("c", 6)) {
    log.push("value " + value)
    break
  }
  console.log(flush())
  let sum = 0
  for (const value of count(1000)) sum += value
  console.log(sum, [...count(4)].join(), Array.from(count(3)).join(), Math.max(...count(6)))
  const [first, second, third] = count(2)
  console.log(first, second, third)
  const [only] = once("d", 8)
  console.log(only, flush())
  console.log([...nested(4)].join())
}
loops()

function betweenCreationAndStep(): void {
  const made = once("e", 1)
  log.push("made")
  for (const value of made) log.push("value " + value)
  console.log(flush())
  const late = withDefault()
  log.push("made")
  for (const value of late) log.push("value " + value)
  console.log(flush())
  for (const value of withDefault(3)) log.push("value " + value)
  console.log(flush())
}
betweenCreationAndStep()

let total = 0
const lists = [[2, 4, 6], [2, 3, 4], [], [1], [8, 8, 8, 8, 9]]
for (let round = 0; round < 20000; round++) total += firstOdd(lists[round % lists.length]) ?? -1
console.log(total)

function thrown(): void {
  console.log(attempt(() => firstOrUndefined(throwing(0))), attempt(() => firstOrUndefined(throwing(1))), attempt(() => [...throwing(1)].join()), attempt(() => [...throwing(2)].join()))
  const kept = throwing(0)
  try {
    for (const value of kept) log.push("value " + value)
  } catch (error) {
    log.push((error as Error).message)
  }
  const after = kept.next()
  console.log(flush(), after.done, after.value)
}
thrown()

function byHand(): void {
  const made = once("f", 2)
  const a = made.next()
  const b = made.next()
  const c = made.next()
  console.log(a.value, a.done, b.value, b.done, c.value, c.done, flush())
  const closed = once("g", 3)
  const d = closed.return("early")
  const e = closed.next()
  console.log(d.value, d.done, e.value, e.done, flush() === "")
  const failed = once("h", 4)
  console.log(attempt(() => failed.throw(new TypeError("thrown in"))), failed.next().done, flush() === "")
}
byHand()

const seen: Generator<number>[] = []
function stored(): void {
  const made = count(3)
  seen.push(made)
  let text = ""
  for (const value of made) {
    text += value
    if (value === 0) text += "(" + seen[0].next().value + ")"
  }
  console.log(text)
}
stored()

let self: Generator<number> | undefined
function* reentrant(): Generator<number> {
  log.push(attempt(() => self!.next().done))
  yield 1
}
function stepsItself(): void {
  self = reentrant()
  for (const value of self) log.push("value " + value)
  console.log(flush())
}
stepsItself()

function* plain(): Generator<number> {
  yield 1
  yield 2
}
function changed(): void {
  let text = ""
  for (const value of plain()) text += value
  ;(plain.prototype as { return?: unknown }).return = function (this: Generator<number>, value: unknown) {
    log.push("own return")
    return Object.getPrototypeOf(plain.prototype).return.call(this, value)
  }
  for (const value of plain()) {
    text += value
    break
  }
  console.log(text, flush())
  ;(plain.prototype as { next?: unknown }).next = function (this: Generator<number>) {
    log.push("own next")
    return Object.getPrototypeOf(plain.prototype).next.call(this)
  }
  for (const value of plain()) text += value
  console.log(text, flush())
  function* changesWhileRunning(): Generator<number> {
    ;(changesWhileRunning.prototype as { return?: unknown }).return = function () {
      log.push("late return")
      return { done: true, value: undefined }
    }
    yield 1
    log.push("not reached")
  }
  for (const value of changesWhileRunning()) {
    log.push("value " + value)
    break
  }
  console.log(flush())
}
changed()
