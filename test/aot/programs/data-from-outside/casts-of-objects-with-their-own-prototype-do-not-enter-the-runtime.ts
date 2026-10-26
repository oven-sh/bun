// Objects made by Object.create(proto) stay as they are when they are cast to a record type. Once the runtime has looked at one such object, the
// next ones of the same Structure are let through without a call into the runtime, whatever fitting values they hold.
// Only the jsc shell with --aotCountsPath=<path> can count. Elsewhere the program checks the answers alone.
declare const aotRuntimeCounters: undefined | (() => string)
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === 'function' ? aotRuntimeCounters() : '')
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
  let sum = 0
  for (const line of counts.split('\n')) {
    const [calls, name] = line.split('\toperation:')
    if (name !== undefined && !besides.includes(name)) sum += Number(calls)
  }
  return sum
}
// These make the text of a number.
const makeText = ['operationAOTStackStringBuilderAppend', 'operationAOTStackStringBuilderDiscard', 'operationAOTDoubleToString']

interface Zone {
  readonly name: string
}
interface Stamp {
  readonly kind: 'utc' | 'zoned'
  readonly millis: number
  readonly flag: boolean
  readonly zone: Zone | null
  readonly label: string | undefined
  describe(): string
}
const StampProto: any = {
  kind: 'utc',
  describe(this: Stamp) {
    return this.kind + ':' + this.millis
  }
}
function make(millis: number, flag: boolean, zone: Zone | null, label: string | undefined): any {
  const self = Object.create(StampProto)
  self.millis = millis
  self.flag = flag
  self.zone = zone
  self.label = label
  return self
}
const typed = {
  isUtc: (self: Stamp): boolean => self.kind === 'utc',
  format: (self: Stamp): string => self.describe() + (self.flag ? '+' : '-') + (self.zone === null ? 'none' : self.zone.name) + (self.label ?? ''),
  later: (self: Stamp, by: number): number => self.millis + by
}
const untyped: any = typed

const zones: Array<Zone | null> = [null, { name: 'Europe/Rome' }, { name: 'Asia/Tokyo' }]
const stamps: Array<any> = []
for (let i = 0; i < 60; i++) stamps.push(make(i % 4 === 0 ? i * 1.5 : i % 4 === 1 ? i : i % 4 === 2 ? -i * 1e12 : NaN, i % 3 === 0, zones[i % 3], i % 5 === 0 ? undefined : 'l' + i))
function pass(): string {
  let utc = 0, length = 0, sum = 0
  for (const stamp of stamps) {
    if (untyped.isUtc(stamp)) utc++
    length += untyped.format(stamp).length
    const next = untyped.later(stamp, 1)
    if (next === next) sum += next
  }
  return utc + ' ' + length + ' ' + sum
}
console.log(pass())
const before = countsSoFar()
let last = ''
for (let turn = 0; turn < 100; turn++) last = pass()
const after = countsSoFar()
const entered = callsIn(after, ...makeText) - callsIn(before, ...makeText)
console.log(last, entered < 1000 ? 'without the runtime' : 'entered the runtime ' + entered + ' times')

StampProto.kind = 'zoned'
console.log(pass())
StampProto.kind = 'utc'
console.log(pass())
StampProto.extra = 1
console.log(pass())
const own = make(5, true, null, 'own')
own.kind = 'zoned'
console.log(untyped.isUtc(own), untyped.format(own), untyped.later(own, 2))
const deeper = Object.create(make(7, false, zones[1], undefined))
console.log(untyped.isUtc(deeper), untyped.format(deeper), untyped.later(deeper, 3))
