// The order of own keys is the order of creation, whatever the order in the declared type.
interface P { a: number; opt?: number; b: number }
const later: P = { a: 1, b: 2 }
later.opt = 3
const swapped: P = { b: 2, a: 1 }
const withOpt: P = { opt: 0, b: 2, a: 1 }
console.log(JSON.stringify(later), JSON.stringify(swapped), JSON.stringify(withOpt), Object.keys(later).join())
function make(flag: boolean): P { return flag ? { a: 1, b: 2, opt: 3 } : { b: 1, opt: 2, a: 3 } }
console.log(JSON.stringify(make(true)), JSON.stringify(make(false)))
class C { x = 1; y?: number; z = 3; constructor(early: boolean) { if (early) this.y = 2 } }
const c = new C(false)
c.y = 9
console.log(JSON.stringify(c), JSON.stringify(new C(true)))
const indexed: any = { name: "n" }
indexed[2] = "two"; indexed.extra = 1; indexed[1] = "one"
console.log(JSON.stringify(indexed), Object.keys(indexed).join())
const spread = { ...later, a: 5, c: 6 }
console.log(JSON.stringify(spread), JSON.stringify({ c: 0, ...swapped }))
