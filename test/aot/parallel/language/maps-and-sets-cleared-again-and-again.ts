// A Map or Set that is cleared while it is empty, once, twice or after every use, as a cache that is emptied at the end of each round. Iterators that were made before a clear,
// between two clears and over a collection that never held anything see exactly what is added afterwards, in for-of loops, by next(), in forEach and in spreads.
function keysOf<K>(iterator: Iterator<K>): string {
  const seen: K[] = []
  for (let step = iterator.next(); !step.done; step = iterator.next()) seen.push(step.value)
  return "[" + seen.join() + "]"
}

const cache = new Map<string, number>()
let hits = 0
for (let round = 0; round < 20000; round++) {
  if (round % 5 === 0) cache.set("k" + (round % 7), round)
  if (round % 5 === 1 && cache.has("k" + ((round - 1) % 7))) hits++
  cache.clear()
  if (round % 3 === 0) cache.clear()
}
console.log(hits, cache.size)

const map = new Map<string, number>()
map.clear()
const overNothing = map.keys()
map.clear()
map.set("a", 1)
console.log(keysOf(overNothing), map.size)

const beforeClear = map.keys()
map.clear()
const betweenClears = map.keys()
map.clear()
map.clear()
const afterClears = map.entries()
map.set("b", 2)
map.set("c", 3)
console.log(keysOf(beforeClear), keysOf(betweenClears), keysOf(afterClears), [...map.values()].join())

const started = map.keys()
console.log(started.next().value)
map.clear()
map.clear()
map.set("d", 4)
console.log(keysOf(started), keysOf(started))

const set = new Set<number>()
set.clear()
const setOverNothing = set.values()
set.add(1)
set.delete(1)
set.clear()
set.clear()
set.add(2)
console.log(keysOf(setOverNothing), [...set].join())

const visited: string[] = []
const looped = new Map<string, number>([["x", 1], ["y", 2]])
for (const [key, value] of looped) {
  visited.push(key + value)
  if (key === "x") {
    looped.clear()
    looped.clear()
    looped.set("z", 3)
  }
  if (key === "z" && looped.size === 1) {
    looped.clear()
    looped.clear()
    looped.set("w", 4)
  }
}
console.log(visited.join())

const each: string[] = []
const forEachSet = new Set<string>(["p", "q"])
forEachSet.forEach(value => {
  each.push(value)
  if (value === "p") {
    forEachSet.clear()
    forEachSet.clear()
    forEachSet.add("r")
  }
})
console.log(each.join(), forEachSet.size)

const many: Map<number, number>[] = []
for (let i = 0; i < 3000; i++) {
  const one = new Map<number, number>()
  if (i % 2) one.set(i, i)
  one.clear()
  one.clear()
  if (i % 3 === 0) one.set(i, i + 1)
  many.push(one)
}
let sum = 0
for (const one of many) for (const [key, value] of one) sum += key + value
console.log(sum)

const again = new Map<string, number>([["k", 1]])
const overAgain = again.entries()
const passedFirst = again.keys()
console.log(passedFirst.next().value)
again.clear()
again.set("k", 2)
console.log(keysOf(overAgain), keysOf(passedFirst), again.get("k"), again.size, again.has("k"), again.delete("k"), again.size)

for (const perRound of [1, 2, 3, 4, 5, 9, 12, 20, 31, 33, 70]) {
  const rounds = new Map<number | string, number>()
  const members = new Set<number | string>()
  const iterators: Iterator<number | string>[] = []
  let text = ""
  for (let round = 0; round < 12; round++) {
    iterators.push(rounds.keys(), members.values())
    for (let i = 0; i < perRound; i++) {
      const key = round % 2 ? "s" + i : i + round
      rounds.set(key, round)
      members.add(key)
    }
    if (round % 4 === 3) text += iterators.map(keysOf).join("") + ";"
    text += rounds.size + "," + members.size + "," + rounds.has("s0") + "," + members.has(round) + " "
    rounds.clear()
    members.clear()
    if (rounds.size || members.size || rounds.has("s0") || members.has(round) || rounds.get(round) !== undefined) text += "!"
  }
  console.log(perRound, text)
}

const byNumber = new Map<number, number>()
const numbers = new Set<number>()
let checksum = 0
for (let round = 0; round < 3000; round++) {
  const fresh = new Map<number | string, number | string>()
  fresh.set(round % 3 ? round + 0.5 : "k" + round, round % 2 ? round * 1.5 : "v" + round)
  for (const [key, value] of fresh) checksum += String(key).length + String(value).length
  for (let i = 0; i <= round % 6; i++) {
    byNumber.set(round * 7 + i + 0.25, i)
    numbers.add(-i - round)
  }
  checksum += byNumber.size * 3 + numbers.size + (byNumber.get(round * 7 + 0.25) ?? -1) + (numbers.has(-round) ? 1 : 0)
  byNumber.clear()
  numbers.clear()
}
console.log(checksum, byNumber.size, numbers.size)

// A collection that nobody has iterated over is emptied where it stands. Whoever has an iterator that has taken nothing, one that has taken some, or one that is done, and whoever stands in a loop, sees what the language says.
function walkAndClear(size: number, clearAt: number, refill: number): string {
  const map = new Map<string, number>()
  const set = new Set<number>()
  for (let i = 0; i < size; i++) {
    map.set("k" + i, i)
    set.add(i * 2)
  }
  const untouched = map.keys()
  const started = map.entries()
  const startedOnSet = set.values()
  const finished = set.keys()
  started.next()
  startedOnSet.next()
  for (const _ of finished) {
  }
  let text = ""
  let steps = 0
  for (const [key, value] of map) {
    text += key + "=" + value + ","
    if (steps++ === clearAt) {
      map.clear()
      for (let i = 0; i < refill; i++) map.set((i % 2 ? "k" : "r") + i, -i)
    }
    if (steps > 200) break
  }
  steps = 0
  for (const value of set) {
    text += value + ","
    if (steps++ === clearAt) {
      set.clear()
      for (let i = 0; i < refill; i++) set.add(i * 3)
    }
    if (steps > 200) break
  }
  return text + "|" + keysOf(untouched) + keysOf(started) + keysOf(startedOnSet) + keysOf(finished) + map.size + "," + set.size
}
for (const size of [1, 3, 4, 5, 8, 9, 20, 32, 33]) {
  for (const clearAt of [0, 1, size - 1, 1000]) {
    for (const refill of [0, 1, 4, 10, 40]) console.log(size, clearAt, refill, walkAndClear(size, clearAt, refill).length, hashOf(walkAndClear(size, clearAt, refill)))
  }
}
function hashOf(text: string): number {
  let result = 0
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0
  return result
}
console.log(walkAndClear(5, 1, 4), walkAndClear(9, 0, 10), walkAndClear(4, 3, 1))

const reused = new Map<string, number>()
const reusedSet = new Set<string>()
let reusedSum = 0
for (let round = 0; round < 5000; round++) {
  const count = (round * 7) % 29
  for (let i = 0; i < count; i++) {
    reused.set("a" + ((i * 5 + round) % 40), i)
    reusedSet.add("b" + ((i * 3 + round) % 40))
  }
  reusedSum += reused.size + reusedSet.size * 2 + (reused.get("a" + (round % 40)) ?? -1) + (reusedSet.has("b" + (round % 40)) ? 1 : 0)
  if (round % 500 === 499) for (const [key, value] of reused) reusedSum += key.length + value
  if (round % 700 === 699) reusedSet.forEach(value => { reusedSum += value.length })
  reused.clear()
  reusedSet.clear()
  if (reused.size || reusedSet.size || reused.has("a1") || reusedSet.has("b1")) reusedSum = NaN
}
console.log(reusedSum)
