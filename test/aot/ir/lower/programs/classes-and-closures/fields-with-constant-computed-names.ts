// RUN: lower
// OPTIONS: builtin-modules

// Instance fields whose computed names are string constants: `readonly [TypeId] = TypeId`. They are own properties in the order
// of their declarations, like fields with written names, and `x[TypeId]` reads them.
const TypeId = '~test/Reason'
const tagName = `${TypeId}/tag` as const
const labelName = 'label'
const errorName = `${TypeId}/error` as const

abstract class Reason<Tag extends string> {
  readonly [TypeId]: typeof TypeId
  readonly first = 1;
  readonly [tagName]: Tag;
  [labelName] = () => 'labelled'
  last: number | undefined
  constructor(tag: Tag) {
    this[TypeId] = TypeId
    this[tagName] = tag
  }
  describe() {
    return this[TypeId] + ' ' + this[tagName] + ' ' + this.first + ' ' + this[labelName].name + ' ' + this.label()
  }
}
class Fail extends Reason<'Fail'> {
  readonly [errorName]: string
  constructor(readonly error: string) {
    super('Fail')
    this[errorName] = error
  }
}

const fail = new Fail('boom')
console.log(Object.keys(fail).join())
console.log(JSON.stringify(fail))
console.log(fail.describe(), fail['~test/Reason/error'], Object.hasOwn(fail, TypeId), TypeId in fail, '~test/Reason/tag' in fail)

let count = 0
for (let i = 0; i < 1000; i++) {
  const each = new Fail('e' + i)
  if (each[TypeId] === TypeId && each[tagName] === 'Fail') count += each.error.length
}
console.log(count)

const hidden: any = fail
delete hidden[tagName]
hidden[tagName] = 'again'
console.log(Object.keys(hidden).join(), hidden.describe())

function makeEarly() {
  return class Early {
    [lateName] = 1
  }
}
try {
  console.log(Object.keys(new (makeEarly())()).join())
} catch (error) {
  console.log((error as Error).name)
}
const lateName = 'late'
console.log(Object.keys(new (makeEarly())()).join())

// GENERATED: makeEarly Fail Early
// CHECK-LABEL: function {{*}}name="makeEarly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_3]]
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_5]]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="lateName"
// CHECK-NEXT: v5 = ToPropertyKey v4
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_3]]
// CHECK-NEXT: v7 = FinishClass v2 layout=[[L_5]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Convert v7 declared={type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = String string="Fail"
// CHECK-NEXT: v6 = SuperConstruct v4, v1, v5 layout=[[L_9]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_10]]
// CHECK-NEXT: PropSet v7, v2 key="error"
// CHECK-NEXT: v12 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13) frequency=Unlikely:
// CHECK-NEXT: v14 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="errorName"
// CHECK-NEXT: v18 = Convert v2 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v15, v18 key="~test/Reason/error"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: v21 = TypeTest v20 testedType=object
// CHECK-NEXT: Branch v21 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v22):
// CHECK-NEXT: Jump -> next b10(v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = TypeTest v23 testedType=undefined
// CHECK-NEXT: Branch v24 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = TypeTest v15 testedType=absent
// CHECK-NEXT: Branch v26 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v27) frequency=Unlikely:
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b9(v29):
// CHECK-NEXT: Jump -> next b10(v29)
// CHECK-NEXT: b10(v30):
// CHECK-NEXT: Return v30
// CHECK-NEXT: b11(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=DerivedConstructorResult name="Fail"
// CHECK-NEXT: Throw v32
// CHECK-NEXT: b12(v33) frequency=Unlikely:
// CHECK-NEXT: v34 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=env [[L_3]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_5]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_13]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
