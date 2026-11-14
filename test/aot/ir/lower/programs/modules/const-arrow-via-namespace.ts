// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5
// CHECK-LABEL: function {{*}}name="makeNext"
// CHECK-LABEL: function {{*}}name="next"
// CHECK-LABEL: function {{*}}name="next"

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
