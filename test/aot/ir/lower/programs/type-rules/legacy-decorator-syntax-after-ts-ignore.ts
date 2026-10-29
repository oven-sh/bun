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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_4]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|function site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined site=[[w_6]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = PropGet v0 key="name"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined site=[[w_6]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Chained"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_13]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="WithStaticPrivate"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_15]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return v10
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
