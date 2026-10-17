// An object is created as a base type and gets the optional fields of a subtype later, one store at a time, many times over at the same sites.
const show = (what: string, o: object) => console.log(what, JSON.stringify(Object.keys(o)), JSON.stringify(o, (key, value) => (key === "target" || key === "constraint" ? value.id : typeof value === "function" ? "function" : value)))
interface Type { flags: number; id: number }
interface ObjectType extends Type { objectFlags: number; members?: string[] }
interface AnonymousType extends ObjectType { target?: AnonymousType; mapper?: (n: number) => number; count?: number; ratio?: number; label?: string; done?: boolean; note?: string | null }
interface TypeParameter extends Type { constraint?: Type; target?: TypeParameter; isThis?: boolean }
interface UnionType extends Type { types?: Type[]; origin?: Type | undefined }
let nextId = 0
function TypeCtor(this: Type, flags: number) { this.flags = flags; this.id = ++nextId }
const Type = TypeCtor as unknown as new (flags: number) => Type
function createObjectType(objectFlags: number): ObjectType { const made = new Type(1) as ObjectType; made.objectFlags = objectFlags; return made }
function instantiate(from: AnonymousType, step: number): AnonymousType {
  const result = createObjectType(from.objectFlags | 64) as AnonymousType
  result.target = from
  result.mapper = n => n + step
  return result
}
function clone(from: TypeParameter): TypeParameter { const result = new Type(2) as TypeParameter; result.target = from; return result }
function constrain(parameter: TypeParameter, constraint: Type) { parameter.constraint = constraint }
function setCount(type: AnonymousType, count: number) { type.count = count }
function setRatio(type: AnonymousType, ratio: number) { type.ratio = ratio }
function setLabel(type: AnonymousType, label: string) { type.label = label }
function setDone(type: AnonymousType, done: boolean) { type.done = done }
function setNote(type: AnonymousType, note: string | null) { type.note = note }
function setOrigin(type: UnionType, origin: Type | undefined) { type.origin = origin }
function setTypes(type: UnionType, types: Type[]) { type.types = types }

const root = createObjectType(0) as AnonymousType
let last = root
let sum = 0
for (let i = 0; i < 20000; i++) {
  const made = instantiate(i % 3 ? root : last, i)
  sum += made.mapper!(made.target!.id) + made.objectFlags
  if (i % 1000 === 0) last = made
}
console.log("instantiated", sum, nextId)
show("one", instantiate(root, 1))

const parameter = new Type(2) as TypeParameter
let chain = parameter
for (let i = 0; i < 5000; i++) {
  chain = clone(chain)
  constrain(chain, i % 2 ? root : parameter)
}
let depth = 0
for (let at: TypeParameter | undefined = chain; at; at = at.target) depth += at.constraint ? at.constraint.flags : 10
console.log("cloned", depth)
show("parameter", chain)

// Every kind of value, each the first field of the subtype that the object gets.
const kinds: AnonymousType[] = []
for (let i = 0; i < 3000; i++) {
  const made = createObjectType(i) as AnonymousType
  switch (i % 8) {
    case 0: setCount(made, i); break
    case 1: setCount(made, i + 0.5); break
    case 2: setRatio(made, -0); break
    case 3: setLabel(made, "l" + i); break
    case 4: setDone(made, i % 16 === 4); break
    case 5: setNote(made, null); break
    case 6: setNote(made, "n"); break
    default: setCount(made, 2 ** 40 + i)
  }
  if (i >= 2992) kinds.push(made)
}
for (const kind of kinds) show("kind", kind)
console.log(Object.is(kinds[2].ratio, -0), kinds[7].count)

// The order of the keys is the order of the stores.
const forwards = createObjectType(1) as AnonymousType
setCount(forwards, 1); setLabel(forwards, "a"); setDone(forwards, true)
const backwards = createObjectType(1) as AnonymousType
setDone(backwards, false); setLabel(backwards, "b"); setCount(backwards, 2)
show("forwards", forwards); show("backwards", backwards)

// `undefined` is a value: the key is there.
const unions: UnionType[] = []
for (let i = 0; i < 2000; i++) {
  const union = new Type(4) as UnionType
  setOrigin(union, i % 2 ? undefined : root)
  if (i % 5 === 0) setTypes(union, [root, union])
  if (i >= 1994) unions.push(union)
}
for (const union of unions) console.log("origin" in union, union.origin?.id, Object.keys(union).join(), union.types?.length)

// Objects that refuse, at sites that have made the transition thousands of times.
function attempt(what: string, run: () => void) { try { run(); console.log(what, "stored") } catch (error) { console.log(what, (error as Error).constructor.name) } }
const frozen = Object.freeze(createObjectType(1)) as AnonymousType
attempt("frozen", () => setCount(frozen, 1)); show("frozen", frozen)
const sealed = Object.seal(createObjectType(1)) as AnonymousType
attempt("sealed", () => setLabel(sealed, "x")); show("sealed", sealed)
const closed = Object.preventExtensions(createObjectType(1)) as AnonymousType
attempt("closed", () => { closed.target = root }); show("closed", closed)
attempt("closed, written", () => { closed.objectFlags = 9 }); show("closed", closed)

// An object that has a property nobody declared keeps it, in its place among the keys.
const marked = createObjectType(1) as AnonymousType
;(marked as any).extra = "kept"
setCount(marked, 3); marked.target = root
show("marked", marked)
delete (marked as any).extra
setLabel(marked, "after"); show("marked", marked)

// A field that was deleted comes back last.
const again = instantiate(root, 1)
delete again.target
show("deleted", again)
again.target = last
show("stored again", again)

// Old objects that get young ones.
const host = globalThis as any
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc
const old: AnonymousType[] = []
for (let i = 0; i < 2000; i++) old.push(createObjectType(i) as AnonymousType)
collect()
for (let i = 0; i < old.length; i++) { old[i].target = createObjectType(-i) as AnonymousType; old[i].mapper = n => n * i * 3; if (i % 500 === 0) collect() }
collect()
let kept = 0
for (let i = 0; i < old.length; i++) kept += old[i].target!.objectFlags + old[i].mapper!(1)
console.log("kept", kept)
