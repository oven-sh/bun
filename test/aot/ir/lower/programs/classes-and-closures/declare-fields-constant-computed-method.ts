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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_4]]}
// CHECK-NEXT: PropSet v4, v6 key="steps"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="nextId"
// CHECK-NEXT: v10 = Increment v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="nextId"
// CHECK-NEXT: PutModuleVariable v11 variable=[[g_5]]
// CHECK-NEXT: v15 = Convert v10 declared={type=number site=[[w_7]]}
// CHECK-NEXT: PropSet v4, v15 key="id"
// CHECK-NEXT: v17 = Convert v1 declared={type=undefined|null|[[L_1]] site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v4, v17 key="value"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v21):
// CHECK-NEXT: Jump -> next b4(v21)
// CHECK-NEXT: b3(v22):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="step"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]] site=[[w_9]]} results=[{type=undefined|null|[[L_3]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="steps"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_11]]}
// CHECK-NEXT: PropSet v0, v3 key="steps"
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|[[L_3]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
