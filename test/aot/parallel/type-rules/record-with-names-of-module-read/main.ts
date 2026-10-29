// A module namespace that is only read from never comes to be as an object, so it opens no record type that has its names.
// One that is handed on as a value does.
// IR- ^layout (L\d+) .*name="Attempt" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="Codec" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
import * as Steps from './steps'
import * as Codecs from './codecs'
import { Grouped } from './grouped'
import * as Callers from './callers'

interface Attempt {
  attempt: () => number
  recover: (error: unknown) => number
}
interface Codec {
  decode: (text: string) => number
  encode: (value: number) => string
}
interface Named {
  label: () => string
}

function run(options: Attempt): number {
  try {
    return options.attempt()
  } catch (error) {
    return options.recover(error)
  }
}
function roundTrip(codec: Codec, text: string): string {
  return codec.encode(codec.decode(text) + 1)
}
function labelOf(named: Named): string {
  return named.label()
}

const untyped: any = [Codecs, { decode: (text: string) => text.length, encode: (value: number) => '#' + value }]
console.log(run({ attempt: () => Steps.attempt(), recover: () => -1 }), run({ attempt: () => { throw new Error('no') }, recover: error => Steps.recover(error) }))
console.log(roundTrip(Codecs, '41'), roundTrip(untyped[0], '6'), roundTrip(untyped[1], 'abc'))
console.log(labelOf(Grouped.Labels), Grouped.Labels.label(), Grouped.Steps.attempt(), Callers.whoCalls(), typeof Callers.whoCalls, Callers.arrow())
