// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// With `experimentalDecorators` plain Bun runs a decorator that is a chain of calls, and a decorated class with a static private name: both errors are TypeScript's own, so `@ts-ignore` suppresses them.
const seen: string[] = [];
const make = () => () => (target: Function) => void seen.push(target.name);
const decorate = (target: Function) => void seen.push(target.name);
// @ts-ignore
@make()()
class Chained {}
// @ts-ignore
@decorate
class WithStaticPrivate { static #count = 1; static read() { return WithStaticPrivate.#count; } }
console.log(seen.join(), Chained.name, WithStaticPrivate.read());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true } }

// GENERATED: make decorate Chained read
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = PropGet v0 key="name"
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Chained"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="WithStaticPrivate"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b4()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v5 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: v11 = PropGet v10 key="#count"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b6(v12):
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v13
// CHECK-NEXT: }
