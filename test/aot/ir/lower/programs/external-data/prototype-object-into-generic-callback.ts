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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|string, v2: undefined|null|[[f_2]]):
// CHECK-NEXT: v3 = PropGet v0 key="names"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="="
// CHECK-NEXT: v6 = Add v1, v5
// CHECK-NEXT: v7 = Call v2 calleeName="run"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Call v4, v3, v8 calleeKey="push" calleeName="this.names.push"
// CHECK-NEXT: v10 = Convert v9 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeHandlers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_3]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_3]]>):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="HandlersProto"
// CHECK-NEXT: v3 = NewObject layout=[[L_5]]
// CHECK-NEXT: SetLiteralPrototype v3, v2 [refusesOtherValues]
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = NewArray v9 contents=anything
// CHECK-NEXT: PropSet v5, v10 key="names"
// CHECK-NEXT: v12 = Convert v5 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="group"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_3]]> flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_3]]>, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="makeHandlers"
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="makeHandlers"
// CHECK-NEXT: v5 = Call v1, -, v4 calleeName="build"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
