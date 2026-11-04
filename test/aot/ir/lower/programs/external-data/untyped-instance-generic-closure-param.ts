// RUN: lower
// OPTIONS: builtin-modules

// A closure with its own type parameter is called through the value that another function returns. Its parameter is a type
// literal that mentions the type parameter. The argument is typed by an interface, and the object behind it is an instance of
// a class whose base class is only known at run time, so it has no layout.
interface Pipeable {
  pipe(): string
}
const Base: new () => Pipeable = (function () {
  function PipeableBase() {}
  PipeableBase.prototype = {
    pipe() {
      return 'piped'
    },
  }
  return PipeableBase as any
})()
interface Codec<Decoded, Encoded> extends Pipeable {
  readonly decode: (input: Encoded) => Decoded
  readonly encode: (input: Decoded) => Encoded
}
const Codec: new <Decoded, Encoded>(decode: (input: Encoded) => Decoded, encode: (input: Decoded) => Encoded) => Codec<Decoded, Encoded> = class<Decoded, Encoded> extends Base {
  readonly decode: (input: Encoded) => Decoded
  readonly encode: (input: Decoded) => Encoded
  constructor(decode: (input: Encoded) => Decoded, encode: (input: Decoded) => Encoded) {
    super()
    this.decode = decode
    this.encode = encode
  }
}
function link<Decoded>() {
  return <Encoded,>(sample: Encoded, codec: { readonly decode: (input: Encoded) => Decoded; readonly encode: (input: Decoded) => Encoded }) => codec.encode(codec.decode(sample))
}
const numberFromString: Codec<number, string> = new Codec((text: string) => Number(text) + 1, (value: number) => String(value))
console.log(link<number>()('41', numberFromString))
console.log(link<number>()('four', { decode: text => text.length, encode: value => 'x'.repeat(value) }))
console.log(numberFromString.pipe())

// GENERATED: link Codec decode encode pipe
// CHECK-LABEL: function {{*}}name="link"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Codec"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|[[f_2]], v3: undefined|null|[[f_3]]):
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1 layout=[[L_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_4]]}
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b13(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_5]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: PropSet v14, v2 key="decode"
// CHECK-NEXT: v16 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v16 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: v18 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: PropSet v19, v3 key="encode"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: v22 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v22 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: Jump -> next b11(v23)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = TypeTest v24 testedType=undefined
// CHECK-NEXT: Branch v25 -> taken b8(| 0), notTaken b12(| 0)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = TypeTest v19 testedType=absent
// CHECK-NEXT: Branch v27 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b10(v30):
// CHECK-NEXT: Jump -> next b11(v30)
// CHECK-NEXT: b11(v31):
// CHECK-NEXT: Return v31
// CHECK-NEXT: b12(v32):
// CHECK-NEXT: v33 = NewRuntimeError runtimeError=DerivedConstructorResult
// CHECK-NEXT: Throw v33
// CHECK-NEXT: b13(v34):
// CHECK-NEXT: v35 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="encode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = String string="x"
// CHECK-NEXT: v2 = PropGet v1 key="repeat"
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeKey="repeat" calleeName="repeat"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pipe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="piped"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
