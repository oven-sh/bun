// Methods are bound to their object in the constructor, by names that are known at compile time and by names that are not.
function bindAll(self: any) {
  for (const key of Reflect.ownKeys(Object.getPrototypeOf(self))) {
    if (key === "constructor") continue
    const descriptor = Reflect.getOwnPropertyDescriptor(Object.getPrototypeOf(self), key)
    if (descriptor && typeof descriptor.value === "function") self[key] = self[key].bind(self)
  }
}
const later: (() => string)[] = []
class Auto {
  name: string
  constructor(name: string) { this.name = name; bindAll(this); later.push(this.hello) }
  hello() { return "hello " + this.name }
  twice() { return this.hello() + this.hello() }
}
class Manual {
  count = 0
  constructor() { this.bump = this.bump.bind(this) }
  bump() { return ++this.count }
}
const a = new Auto("a")
console.log(later[0]!(), a.hello(), a.twice(), Object.keys(a).join())
const detached = a.twice
console.log(detached())
const m = new Manual()
const bump = m.bump
console.log(bump(), bump(), m.bump(), m.count)
