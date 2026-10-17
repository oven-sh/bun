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
