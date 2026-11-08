// `cache.clear()` at the end of each turn, of a cache that most turns leave empty, where the call is closed: the stub sees that no entry is alive and enters no operation.
// COUNT: operation:operationAOTMapClearOfAnyMap <= 40
// COUNT: operation:operationAOTSetClearOfAnySet <= 40
type Caches = { byName: Map<string, number>; seen: Set<string> }
const all: any[] = []
for (let i = 0; i < 8; i++) all.push({ byName: new Map<string, number>(), seen: new Set<string>() } satisfies Caches)
all.push({ byName: { clear() { calls++ } }, seen: { clear() { calls += 10 } } })
let calls = 0
let sizes = 0
for (let turn = 0; turn < 2000; turn++) {
  for (const caches of all) {
    if (turn % 500 === 0 && caches.byName instanceof Map) { caches.byName.set("k" + turn, turn); caches.seen.add("m" + turn) }
    sizes += (caches.byName.size ?? 0) + (caches.seen.size ?? 0)
    const first = caches.byName.clear()
    const second = caches.seen.clear()
    if (first !== undefined || second !== undefined) throw new Error("clear() gave something")
    sizes += (caches.byName.size ?? 0) + (caches.seen.size ?? 0)
  }
}
console.log(calls, sizes)
