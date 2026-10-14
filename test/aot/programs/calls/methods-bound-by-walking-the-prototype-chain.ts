// The npm package auto-bind, as it is written.
const getAllProperties = (object: any) => {
  const properties = new Set<[any, string | symbol]>()
  do {
    for (const key of Reflect.ownKeys(object)) properties.add([object, key])
  } while ((object = Reflect.getPrototypeOf(object)) && object !== Object.prototype)
  return properties
}
function autoBind(self: any, { include, exclude }: { include?: (string | RegExp)[]; exclude?: (string | RegExp)[] } = {}) {
  const filter = (key: string | symbol) => {
    const match = (pattern: string | RegExp) => (typeof pattern === "string" ? key === pattern : pattern.test(key as string))
    if (include) return include.some(match)
    if (exclude) return !exclude.some(match)
    return true
  }
  for (const [object, key] of getAllProperties(self.constructor.prototype)) {
    if (key === "constructor" || !filter(key)) continue
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key)
    if (descriptor && typeof descriptor.value === "function") self[key] = self[key].bind(self)
  }
  return self
}
const kept: (() => string)[] = []
class Base { base() { return "base of " + (this as any).name } }
class App extends Base {
  name = "app"
  constructor() { super(); autoBind(this); kept.push(this.stop, this.base) }
  stop() { return "stopped " + this.name }
  get size() { return 1 }
}
const app = new App()
console.log((app as any).constructor === App, (app as any).constructor.prototype === Object.getPrototypeOf(app), App.prototype === Object.getPrototypeOf(app))
console.log(kept.map(f => f()).join(), Object.keys(app).join(), app.size)
// The bound method is read in another method, put in an object, and called as a method of that object.
class View {
  name = "view"
  constructor() { autoBind(this) }
  stop(why?: string) { return "stopped " + this.name + " " + why }
  props() { return { onExit: this.stop, other: 1 } }
  viaDestructuring() { const { stop } = this; return stop }
}
const view = new View()
const props = view.props()
console.log(props.onExit("a"), view.viaDestructuring()("b"))
const unknownProps: any = JSON.parse('{"x":1}')
unknownProps.onExit = view.props().onExit
console.log(unknownProps.onExit("c"))
// A class that is never used as a value still has `constructor` on its prototype.
class Plain { x = 1 }
class Derived extends Plain { y = 2; m() { return this.y } }
const d: any = new Derived(), q: any = new Plain()
console.log(d.constructor.name, q.constructor.name, d.constructor.prototype === Object.getPrototypeOf(d), Object.getPrototypeOf(d.constructor) === q.constructor, Object.getPrototypeOf(q) === Object.prototype, d.constructor === new Derived().constructor)
