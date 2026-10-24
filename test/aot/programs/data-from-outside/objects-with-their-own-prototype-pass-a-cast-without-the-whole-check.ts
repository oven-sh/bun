// Objects made by Object.create(proto) are used through record types thousands of times. Any object passes where a record type is written, and a field is read
// where the object has it, its own or inherited, also after the prototype gains, loses or changes a member. What the program prints is what plain Bun prints.
// Only the jsc shell with --aotCountsPath=<path> can count. Elsewhere the program checks the answers alone.
declare const aotOperationCount: undefined | ((name: string) => number)
const count = typeof aotOperationCount === 'function' ? aotOperationCount : () => 0

interface Cell<A> {
  current: A
}
interface Box<A> {
  readonly kind: string
  readonly cell: Cell<A>
  readonly note?: string
  describe(): string
}
const CellProto = {
  toJSON(this: Cell<any>) {
    return { current: this.current }
  },
}
const BoxProto = {
  kind: 'box',
  describe(this: Box<any>) {
    return this.kind + ':' + this.cell.current
  },
}
const makeCell = <A>(value: A): Cell<A> => {
  const self = Object.create(CellProto)
  self.current = value
  return self
}
const makeBox = <A>(value: A): Box<A> => {
  const self = Object.create(BoxProto)
  self.cell = makeCell(value)
  return self
}
const dual: {
  <DataLast extends (...args: Array<any>) => any, DataFirst extends (...args: Array<any>) => any>(arity: number, body: DataFirst): DataLast & DataFirst
} = function (arity: number, body: Function) {
  return function (this: unknown) {
    if (arguments.length >= arity) return body.apply(this, arguments)
    const args = arguments
    return (self: any) => body(self, ...args)
  }
} as any
const later = <A>(evaluate: () => A): { run: () => A } => ({ run: evaluate })
const bump: {
  (by: number): (self: Box<number>) => { run: () => number }
  (self: Box<number>, by: number): { run: () => number }
} = dual(2, (self: Box<number>, by: number) =>
  later(() => {
    self.cell.current = self.cell.current + by
    return self.cell.current
  }))
const label: {
  (suffix: string): (self: Box<number>) => { run: () => string }
  (self: Box<number>, suffix: string): { run: () => string }
} = dual(2, (self: Box<number>, suffix: string) => later(() => self.describe() + (self.note ?? '') + suffix))

const boxes = [makeBox(1), makeBox(10), makeBox(100)]
let sum = 0
for (let i = 0; i < 30; i++) sum += bump(boxes[i % 3], 1).run()
const before = count('operationAOTEnforceType')
for (let i = 0; i < 3000; i++) sum += bump(boxes[i % 3], 1).run()
const entered = count('operationAOTEnforceType') - before
console.log(sum, entered < 300 ? 'without the whole check' : 'the whole check ran ' + entered + ' times')
const labels = () => boxes.map(box => label(box, '.').run()).join()
console.log(labels())

const untypedProto: any = BoxProto
untypedProto.note = '!'
console.log(labels())
delete untypedProto.note
console.log(labels())
untypedProto.kind = 'crate'
console.log(labels())
const own: any = makeBox(7)
own.note = '?'
own.kind = 'own'
console.log(label(own, '.').run(), bump(own, 2).run(), JSON.stringify(own.cell), Object.getPrototypeOf(own) === BoxProto)
const deeper: any = Object.create(makeBox(5))
console.log(label(deeper, '.').run(), bump(deeper, 3).run(), label(deeper, '.').run())
const ordinaryProto: any = { kind: 'ordinary', describe() { return this.kind + '=' + this.cell.current } }
const ordinary = (value: number): any => {
  const self = Object.create(ordinaryProto)
  self.cell = makeCell(value)
  return self
}
console.log(label(ordinary(1), '.').run(), label(ordinary(2), '.').run(), bump(ordinary(3), 4).run())
ordinaryProto.note = '+'
console.log(label(ordinary(1), '.').run(), label(ordinary(2), '.').run())
