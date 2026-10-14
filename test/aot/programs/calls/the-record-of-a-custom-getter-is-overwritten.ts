// Calls: the record of a custom getter is overwritten.
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
// THE COUNT OF A RECORD's FILLINGS OUTLIVES THE COLLECTION THAT EMPTIES THE RECORD. IF IT DID NOT, THE NUMBERS WOULD BEGIN ANEW: a site that learnt the first filling behind one collection would be served by the first filling behind the next, whoever's that is. Which record a pair falls on is not mine to choose: 128 fresh pairs fill a given record exactly once with a chance of 0.37: forty trials, three sites.
// WHO LEARNS MUST BE WHO IS ASKED: victimsAreRight() BOTH TIMES: THE THREE SMALL FUNCTIONS ARE TAKEN INTO EACH CALLER: A CALL OF THEM FROM THE MODULE's OWN CODE IS ANOTHER SITE WITH ANOTHER SLOT, WHICH HAS LEARNT NOTHING (10:4x: x203z AND x203s PASSED THE SECOND AND THE THIRD FORM BY THAT).
// THE HEIRS OF EVERY TRIAL ARE KEPT ALIVE: ELSE THE NEXT FULL COLLECTION FREES THEIR Structures AND THE NEXT TRIAL GETS THE SAME IDENTIFIERS, SO THE SAME RECORDS: FORTY TRIALS WERE ONE (10:3x: x203z PASSED THE FIRST FORM).
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
