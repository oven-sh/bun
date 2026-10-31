// RUN: lower
// OPTIONS: builtin-modules

// A generic function makes an object with Object.create(prototype), types it with a generic interface, and hands it to the
// caller's callback. The callback's parameter is an instantiation of that interface.
interface Endpoint<Name extends string> {
  readonly name: Name
}
interface Handlers<Endpoints extends Endpoint<string>, Handled extends string = never> {
  readonly '~Endpoints': Endpoints
  readonly names: string[]
  handle<Name extends Exclude<Endpoints['name'], Handled>>(name: Name, run: () => string): Handlers<Endpoints, Handled | Name>
}
const HandlersProto = {
  handle(this: Handlers<any, any>, name: string, run: () => string) {
    this.names.push(name + '=' + run())
    return this
  },
}
const makeHandlers = <Endpoints extends Endpoint<string>>(endpoints: readonly Endpoints[]): Handlers<Endpoints> => {
  const self = Object.create(HandlersProto)
  self.names = [String(endpoints.length)]
  return self
}
const group = <Endpoints extends Endpoint<string>, Result>(endpoints: readonly Endpoints[], build: (handlers: Handlers<Endpoints>) => Result): Result => build(makeHandlers(endpoints))
const text: Endpoint<'text'> = { name: 'text' }
const json: Endpoint<'json'> = { name: 'json' }
const built = group([text, json], handlers => handlers.handle('text', () => 'hello').handle('json', () => '{}'))
console.log(built.names.join())

// GENERATED: handle makeHandlers group
// CHECK-LABEL: function {{*}}name="handle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|string, v2: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="names"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="="
// CHECK-NEXT: v6 = Add v1, v5
// CHECK-NEXT: v7 = Call v2 calleeName="run"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Call v4, v3, v9 calleeKey="push" calleeName="this.names.push"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeHandlers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_10]]> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_10]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="HandlersProto"
// CHECK-NEXT: v5 = Call v2, v1, v4 calleeName="Object.create"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|number|string|symbol|bigint|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Call v7, -, v9 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = NewArray v11 contents=anything
// CHECK-NEXT: PropSet v6, v12 key="names"
// CHECK-NEXT: v14 = Convert v6 declared={type=undefined|null|[[L_1]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="group"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_18]]> site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_22]] site=[[w_23]]}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_18]]>, v1: undefined|null|[[f_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_25]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="makeHandlers"
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="makeHandlers"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] site=[[w_26]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Call v1, -, v5 calleeName="build"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|[[L_22]] site=[[w_27]]}}, {declared={type=undefined|null|[[L_22]] site=[[w_23]]}}]
// CHECK-NEXT: }
