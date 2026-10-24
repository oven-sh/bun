// A class declares its fields with `declare` (no code is emitted for them; the constructor creates each by storing to it) and
// has an accessor and a method whose computed names are string constants. The fields behave as own properties that appear in
// the order of the stores. A computed name that equals the name of a declared field wins over the field.
const TypeId = '~test/Fiber'
const describeName = `${TypeId}/describe` as const
const shadowedName = 'shadowed'
let nextId = 0

class Fiber<A> {
  declare readonly id: number
  declare steps: number
  declare value: A | undefined
  declare late: string | undefined
  declare shadowed: number

  constructor(value: A) {
    this.steps = 0
    this.id = ++nextId
    this.value = value
  }
  get [TypeId]() {
    return 'fiber ' + this.id
  }
  [describeName]() {
    return this.id + ':' + this.steps + ':' + String(this.value)
  }
  get [shadowedName]() {
    return 42
  }
  step() {
    this.steps++
    return this
  }
}

const fiber = new Fiber('a')
console.log(Object.keys(fiber).join(), 'late' in fiber, Object.hasOwn(fiber, 'late'), fiber.late)
fiber.late = 'now'
console.log(Object.keys(fiber).join(), 'late' in fiber, Object.hasOwn(fiber, 'late'), fiber.late)
console.log(fiber[TypeId], fiber[describeName](), fiber.step().step()[describeName]())
console.log(fiber.shadowed, Object.hasOwn(fiber, 'shadowed'), 'shadowed' in fiber)
console.log(JSON.stringify(fiber), JSON.stringify(new Fiber(7).step()))

let total = 0
for (let i = 0; i < 1000; i++) {
  const each = new Fiber(i)
  total += each.step().steps + each.id + (each.value ?? 0)
}
console.log(total)

const hidden: any = new Fiber(true)
hidden.extra = 1
delete hidden.steps
console.log(Object.keys(hidden).join(), hidden.steps, hidden[describeName]())
