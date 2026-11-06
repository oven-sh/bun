// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// `export const f = () => ..` of another module, called through a namespace: `import * as ns`, or a folder's `export * as default from '.'`.
// One of its parameters is a record with one function member, and the argument is a function that has that member as a property.
import Steps from './steps'
import * as Direct from './steps/pass-on'
import type { WithNext } from './steps'
import * as Late from './late'
import { tooEarly } from './early'

type Continue<E, O> = ((e: E) => Promise<O>) & WithNext<E, O> & { readonly label: string }

function makeNext(): Continue<string, string> {
  return Object.assign(async (e: string) => e + '!', {
    next: async (e: string, ...rest: unknown[]) => e + rest.length,
    label: 'next',
  })
}
function wrap(next: Continue<string, string>) {
  return {
    next: async (passed: string, ...rest: unknown[]) => 'w' + (await Steps.passOn(passed, next, rest)),
    label: next.label,
  }
}
const next = makeNext()
const wrapped = wrap(next)
console.log(await next('a'), await wrapped.next('a', 1, 2), await Steps.passOn('b', wrapped, [1]), await Direct.passOn('c', next, []))
console.log(Steps.twice(4), Direct.twice(5), Steps.sum(1, 2, 3), Steps.sum(...[4, 5]), Direct.sum(), Steps.label({ name: 'n' }), Steps.twice?.(6), (Steps.twice)(7))
console.log(Steps.twice === Direct.twice, Steps.twice.name, typeof Steps.passOn, [1, 2].map(Steps.twice).join())
console.log(Late.early(), tooEarly(), Late.answer())

// FILE: early.ts
import * as Late from './late'
export function tooEarly() { try { return Late.answer() } catch (e) { return e instanceof ReferenceError ? 'ReferenceError' : 'other ' + e } }
export const seen = tooEarly()

// FILE: late.ts
import { seen } from './early'
export const answer = () => 42
export const early = () => seen

// FILE: steps/index.ts
export * from './pass-on'
export type * from './with-next'

export * as default from '.'

// FILE: steps/pass-on.ts
import type { WithNext } from './with-next'

export const passOn = <E, O>(e: E, to: WithNext<E, O>, rest: readonly unknown[]): Promise<O> =>
  (to.next as (e: E, ...rest: readonly unknown[]) => Promise<O>)(e, ...rest)
export const twice = (n: number) => n * 2
export const sum = (...all: number[]) => all.reduce((a, b) => a + b, 0)
export const label = (of: { name: string }) => '<' + of.name + '>'

// FILE: steps/with-next.ts
export type WithNext<E, O> = {
  readonly next: (e: E, depth: never) => Promise<O>
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: makeNext next
// CHECK-LABEL: function {{*}}name="makeNext"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_5]]|[[f_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = String string="next"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = NewObject -, v4, v6 layout=[[L_7]] fields=[1, 0]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = Call v1, v0, v2, v8 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|[[f_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, HasRestParameter, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=Array site=[[w_11]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Add v0, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string|object site=[[w_13]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, HasRestParameter, IsChecked] length=1 syntax=[HasWrittenAwait] captures=[{type=undefined|null|[[f_1]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}, {type=Array site=[[w_16]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: undefined|null|string, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="w"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="passOn"
// CHECK-NEXT: v6 = ModuleNamespace module=[[m_18]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v8 = Call v5, v7, v1, v0, v2 calleeName="Steps.passOn"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Await v9, v1, v2
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v12 = Add v3, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string|object site=[[w_20]]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
