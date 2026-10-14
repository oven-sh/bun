// `as const satisfies T`: the object is of the type the expression has, not of the type it is only compared with.
type Key = "first" | "second"
export const FILES = { first: "one.json", second: "two.json" } as const satisfies Record<Key, string>
const IDS = ["first", "second"] as const satisfies readonly Key[]
function pick(key: Key): string { return FILES[key] }
console.log(FILES.first, pick("second"), IDS.join(), Object.keys(FILES).join())
const plain = { first: 1, second: 2 } satisfies Record<Key, number>
console.log(plain.first + plain.second)
const nested = { inner: { first: "a", second: "b" } } as const satisfies { inner: Record<Key, string> }
console.log(nested.inner.second)
