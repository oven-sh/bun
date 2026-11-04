// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: Fiber step
// CHECK-LABEL: function {{*}}name="Fiber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: PropSet v4, v5 key="steps"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="nextId"
// CHECK-NEXT: v9 = Increment v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="nextId"
// CHECK-NEXT: PutModuleVariable v10 variable=[[g_2]]
// CHECK-NEXT: PropSet v4, v9 key="id"
// CHECK-NEXT: PropSet v4, v1 key="value"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v18):
// CHECK-NEXT: Jump -> next b2(v18)
// CHECK-NEXT: b2(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="step"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="steps"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: PropSet v0, v2 key="steps"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
