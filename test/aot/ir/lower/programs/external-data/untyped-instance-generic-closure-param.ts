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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Codec"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|[[f_4]], v3: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1 layout=[[L_9]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_10]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v2 declared={type=undefined|null|[[f_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v14, v15 key="decode"
// CHECK-NEXT: v17 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18) frequency=Unlikely:
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v19
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = Convert v3 declared={type=undefined|null|[[f_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v20, v21 key="encode"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: v24 = TypeTest v23 testedType=object
// CHECK-NEXT: Branch v24 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: Jump -> next b12(v25)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = TypeTest v26 testedType=undefined
// CHECK-NEXT: Branch v27 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: v29 = TypeTest v20 testedType=absent
// CHECK-NEXT: Branch v29 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b11(v32):
// CHECK-NEXT: Jump -> next b12(v32)
// CHECK-NEXT: b12(v33):
// CHECK-NEXT: Return v33
// CHECK-NEXT: b13(v34) frequency=Unlikely:
// CHECK-NEXT: v35 = NewRuntimeError runtimeError=DerivedConstructorResult
// CHECK-NEXT: Throw v35
// CHECK-NEXT: b14(v36) frequency=Unlikely:
// CHECK-NEXT: v37 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_16]]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="encode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_19]]}] results=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="x"
// CHECK-NEXT: v2 = PropGet v1 key="repeat"
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeKey="repeat" calleeName="repeat"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pipe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="piped"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
