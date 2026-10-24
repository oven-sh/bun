// An object with a prototype of its own passes for an interface. A member of the wrong kind throws where typed code reads it. What the
// prototype holds, or has lost, matters only to code that reads those members.
interface Tagged {
  readonly kind: string
  size: number
  describe(): string
}
const Proto = {
  kind: 'tagged',
  describe(this: Tagged) {
    return this.kind + ':' + this.size
  },
}
const make = (size: unknown): Tagged => {
  const self = Object.create(Proto)
  self.size = size
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
const grow: {
  (by: number): (self: Tagged) => { run: () => number }
  (self: Tagged, by: number): { run: () => number }
} = dual(2, (self: Tagged, by: number) => later(() => self.size + by))
const attempt = (value: Tagged): string => {
  try {
    return String(grow(value, 1).run())
  } catch (error) {
    return error instanceof TypeError ? 'TypeError' : 'other ' + error
  }
}
console.log(attempt(make(1)), attempt(make(2)), attempt(make('three')), attempt(make(4)))
const untypedProto: any = Proto
untypedProto.kind = 5
console.log(attempt(make(6)))
untypedProto.kind = 'again'
console.log(attempt(make(7)))
delete untypedProto.describe
console.log(attempt(make(8)))
