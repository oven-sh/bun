// Typed objects stay ordinary JavaScript objects: properties can be added and deleted, and they can be frozen and sealed.
class P { x = 1; y = "a"; get sum() { return this.x + this.y } }
const log: unknown[] = []
const p = new P()
const loose: any = p
loose.extra = 5
loose[Symbol.for("s")] = "sym"
loose[7] = "seven"
log.push(loose.extra, Object.keys(p).join(), "extra" in p, JSON.stringify(p), loose[Symbol.for("s")], loose[7], p instanceof P, p.sum)
log.push(delete loose.extra, loose.extra, Object.keys(p).join(), Object.getOwnPropertyNames(p).join())
function readX(o: P): number { return o.x }
let total = 0
for (let i = 0; i < 100; i++) total += readX(i % 2 ? p : new P())
log.push(total)
const many: any[] = [p, new P(), { x: 10, y: "lit" }]
log.push(many.map(o => o.x + o.y).join())
const frozen = Object.freeze({ a: 1, b: { c: 2 } })
log.push(Object.isFrozen(frozen), Object.isFrozen(frozen.b), Object.isSealed(frozen), Object.isExtensible(frozen))
try { (frozen as any).a = 2; log.push("written") } catch (e) { log.push((e as Error).constructor.name) }
try { (frozen as any).z = 2; log.push("added") } catch (e) { log.push((e as Error).constructor.name) }
try { delete (frozen as any).a; log.push("deleted") } catch (e) { log.push((e as Error).constructor.name) }
frozen.b.c = 3
log.push(frozen.a, frozen.b.c, JSON.stringify(Object.getOwnPropertyDescriptor(frozen, "a")))
const q = new P()
function bump(o: P): void { o.x++ }
bump(q); Object.freeze(q)
try { bump(q); log.push("bumped") } catch (e) { log.push((e as Error).constructor.name) }
log.push(q.x)
const sealed = Object.seal({ n: 1 })
sealed.n = 2
try { (sealed as any).m = 1; log.push("added") } catch (e) { log.push((e as Error).constructor.name) }
log.push(sealed.n, Object.isSealed(sealed), Object.isFrozen(sealed), JSON.stringify(Object.getOwnPropertyDescriptor(sealed, "n")))
// `k` is optional, so that it may be deleted. Of a required field: type-rules/freeze.
const open: { k?: number } = { k: 1 }
const closed = Object.preventExtensions(open)
closed.k = 5
try { (closed as any).j = 1; log.push("added") } catch (e) { log.push((e as Error).constructor.name) }
log.push(closed.k, Object.isExtensible(closed), delete closed.k, JSON.stringify(closed))
const copy = { ...p, more: true }
log.push(JSON.stringify(copy), JSON.stringify((Object.assign as any)({}, p)), Object.entries(p).length)
Object.defineProperty(loose, "hidden", { value: 9, enumerable: false })
log.push(loose.hidden, Object.keys(p).join())
console.log(log.join("\n"))
