// A written object type takes any object as it is. An object made by Object.create(proto) that untyped code hands to a typed function is not
// converted and nothing in it is looked at on entry: its fields are read where it has them, its own or inherited.
// Only the jsc shell with --aotCountsPath=<path> can count. Elsewhere the program checks the answers alone.
declare const aotOperationCount: undefined | ((name: string) => number)
const count = typeof aotOperationCount === 'function' ? aotOperationCount : () => 0

interface Parts {
  readonly year: number
  readonly month: number
}
interface Moment {
  readonly kind: string
  readonly millis: number
  parts?: Parts
  describe(): string
}
const MomentProto: any = {
  kind: 'utc',
  describe(this: Moment) {
    return this.kind + ':' + this.millis + (this.parts ? '/' + this.parts.year + '-' + this.parts.month : '')
  }
}
function make(millis: number): any {
  const self = Object.create(MomentProto)
  self.millis = millis
  return self
}
const parsed: Moment = JSON.parse('{"kind":"parsed","millis":5,"parts":{"year":2026,"month":2}}')
const typed = {
  isUtc: (self: Moment): boolean => self.kind === 'utc',
  format: (self: Moment): string => (typeof self.describe === 'function' ? self.describe() : self.kind + '?' + self.millis),
  later: (self: Moment, by: number): number => self.millis + by
}
const untyped: any = typed

const moments: Array<any> = []
for (let i = 0; i < 50; i++) moments.push(make(i * 1000))
function pass(): string {
  let utc = 0, length = 0, sum = 0
  for (const moment of moments) {
    if (untyped.isUtc(moment)) utc++
    length += untyped.format(moment).length
    sum += untyped.later(moment, 1)
  }
  return utc + ' ' + length + ' ' + sum
}
console.log(pass(), untyped.format(parsed), untyped.isUtc(parsed), untyped.later(parsed, 2))
const before = count('operationAOTEnforceType')
let last = ''
for (let turn = 0; turn < 100; turn++) last = pass()
const entered = count('operationAOTEnforceType') - before
console.log(last, entered < 1000 ? 'without the runtime' : 'entered the runtime ' + entered + ' times')

moments[3].parts = { year: 2026, month: 10 }
moments[4].millis = 4.5
moments[5].extra = true
console.log(pass(), untyped.format(moments[3]), untyped.later(moments[4], 1), untyped.format(moments[5]))
MomentProto.kind = 'zoned'
console.log(pass())
const frozen = Object.freeze({ kind: 'frozen', millis: 9 })
console.log(untyped.format(frozen), untyped.later(frozen, 1), Object.isFrozen(frozen))
