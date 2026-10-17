// A lookup in a local Map with a key of unknown type, whose result is cast to a type.
interface Entry { name: string }
const entries = new Map<unknown, Entry>()
function find(key: unknown): Entry | undefined { return entries.get(key) }
function anything(): any { return [1, "a", { name: "k" }, null] }
const keys = anything()
entries.set(keys[0], { name: "one" })
entries.set(keys[1], { name: "a" })
entries.set(keys[2], { name: "object" })
for (const key of keys) console.log(find(key)?.name)
;(globalThis as any).find = find
console.log((globalThis as any).find(1).name)
