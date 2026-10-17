// Reads of native getters at more sites than the cache for them has entries.
// ENV JSC_useDollarVM=1
declare const console: { log(...args: unknown[]): void }; declare const $vm: any
function hide(x: unknown): any { return [x, 0][0] }
const holder = $vm.createCustomTestGetterSetter()
function heir(k: number): any { const o = Object.create(holder); o["own" + k] = k; return o }
function victimAccessor(o: any): unknown { return o.customAccessor }
function victimValue(o: any): unknown { return o.customValue }
function victimGlobal(o: any): unknown { return o.customAccessorGlobalObject }
function otherAccessor(o: any): unknown { return o.customAccessor }
function otherValue(o: any): unknown { return o.customValue }
function otherGlobal(o: any): unknown { return o.customAccessorGlobalObject }
function otherValueGlobal(o: any): unknown { return o.customValueGlobalObject }
const a = hide(heir(-1)), b = hide(heir(-2)), c = hide(heir(-3))
function victimsAreRight(): boolean { let ok = true; for (let i = 0; i < 6; i++) ok = ok && victimAccessor(a) === a && victimValue(b) === holder && victimGlobal(c) === globalThis; return ok }
console.log("the three sites learn:", victimsAreRight())
let othersRight = true
for (let round = 0; round < 6; round++) {
    for (let k = 0; k < 700; k++) {
        const o = hide(heir(round * 700 + k))
        othersRight = othersRight && otherAccessor(o) === o && otherValue(o) === holder && otherGlobal(o) === globalThis && otherValueGlobal(o) === globalThis
        if ((k & 63) === 63) othersRight = othersRight && victimsAreRight()
    }
    console.log("round " + round + ": 2,800 other pairs have been noted, and the three sites, asked eleven times between:", victimsAreRight() && othersRight)
    if (round & 1) $vm.gc(); else $vm.edenGC()
    console.log("   and behind a collection, which empties the table:", victimsAreRight())
}
// The fill count of a cache record must survive the collection that empties the record. Otherwise the numbering would restart, and a site that learned the first fill after one collection would be served by the first fill after the next, whoever made it. The test cannot choose which record a pair falls on: 128 fresh pairs fill a given record exactly once with a probability of 0.37, hence forty trials and three sites.
// The site that learns must be the site that is tested, so victimsAreRight() is called both times: the three small functions are inlined into each caller, and a call to them from the module's own code would be a different site with a different slot, which has learned nothing.
// The inheriting objects of every trial are kept alive. Otherwise the next full collection would free their Structures, the next trial would get the same identifiers and therefore the same records, and forty trials would count as one.
let trialsRight = true, next = 100000; const keptAlive: unknown[] = []
for (let trial = 0; trial < 40; trial++) {
    $vm.gc(); trialsRight = trialsRight && victimsAreRight()
    $vm.gc()
    for (let k = 0; k < 32; k++) { const o = hide(heir(next++)); keptAlive.push(o); trialsRight = trialsRight && otherAccessor(o) === o && otherValue(o) === holder && otherGlobal(o) === globalThis && otherValueGlobal(o) === globalThis }
    trialsRight = trialsRight && victimsAreRight()
}
console.log("forty trials: learnt behind one collection, asked behind the next and 128 other pairs:", trialsRight && keptAlive.length === 1280)
console.log("own, not inherited, behind it all:", victimAccessor(holder) === holder && victimValue(holder) === holder && victimGlobal(holder) === globalThis)
console.log("and the first three again:", victimsAreRight())
