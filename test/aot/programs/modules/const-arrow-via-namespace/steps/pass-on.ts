import type { WithNext } from './with-next'

export const passOn = <E, O>(e: E, to: WithNext<E, O>, rest: readonly unknown[]): Promise<O> =>
  (to.next as (e: E, ...rest: readonly unknown[]) => Promise<O>)(e, ...rest)
export const twice = (n: number) => n * 2
export const sum = (...all: number[]) => all.reduce((a, b) => a + b, 0)
export const label = (of: { name: string }) => '<' + of.name + '>'
