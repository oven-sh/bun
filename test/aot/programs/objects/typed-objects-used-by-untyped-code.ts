// User-defined typed objects are read and written by code that does not know their type.
class P {
  flag = true
  small = 7
  big = 5000000000
  real = 1.5
  name = "p"
  next: P | null = null
  maybe: number | undefined = undefined
  opt?: number
  any: unknown = 3
}
function hide(x: unknown): any { return x }
const p = new P()
const x = hide(p)
console.log(x.flag, x.small, x.big, x.real, x.name, x.next, x.maybe, x.opt, x.any, x.none)
x.flag = false
x.small = 8
x.real = 2.25
x.name = "q"
x.next = p
x.maybe = 4
x.any = "s"
console.log(p.flag, p.small, p.real, p.name, p.next === p, p.maybe, p.any)
let total = 0
const many: any[] = [hide(new P()), hide({ small: 1, real: 0.5 }), hide(new P())]
for (let round = 0; round < 1000; round++) {
  for (let i = 0; i < many.length; i++) total += many[i].small + many[i].real
}
console.log(total, Object.keys(x).join(","), JSON.stringify(hide({ a: 1, b: [true, null], c: "d" })))
