// Each iteration of a loop at the top level of a module has its own bindings.
const made: Record<string, { get(): string }> = {}
for (const [name, value] of Object.entries({ a: 1, b: 2, c: 3 })) {
  made[name] = { get() { return name + value } }
}
console.log(made.a!.get(), made.b!.get(), made.c!.get())
const list: (() => number)[] = []
for (const n of [1, 2, 3]) list.push(() => n)
for (let i = 0; i < 3; i++) list.push(() => i)
for (const k in { x: 1, y: 2 }) list.push(() => k.length + list.length)
{
  const inBlock = 7
  list.push(() => inBlock)
}
let w = 0
while (w < 2) { const seen = w++; list.push(() => seen) }
console.log(list.map(f => f()).join())
function inner() {
  const out: (() => string)[] = []
  for (const [k, v] of Object.entries({ p: 1, q: 2 })) out.push(() => k + v)
  return out.map(f => f()).join()
}
console.log(inner())
