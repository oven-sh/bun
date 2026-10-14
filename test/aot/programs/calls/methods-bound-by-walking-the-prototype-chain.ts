// Methods are bound to their object by a helper that walks the prototype chain: Reflect.ownKeys, property descriptors, and lists of names or patterns to take or to leave out.
type Pattern = string | symbol | RegExp
function fits(name: string | symbol, patterns: Pattern[]) {
  for (const pattern of patterns) {
    if (pattern instanceof RegExp ? typeof name === "string" && pattern.test(name) : pattern === name) return true
  }
  return false
}
function methodsFrom(first: any) {
  const holders = new Map<string | symbol, any>()
  for (let holder = first; holder && holder !== Object.prototype; holder = Reflect.getPrototypeOf(holder)) {
    for (const name of Reflect.ownKeys(holder)) {
      if (name !== "constructor" && !holders.has(name)) holders.set(name, holder)
    }
  }
  return holders
}
function bindMethods(target: any, { include, exclude }: { include?: Pattern[]; exclude?: Pattern[] } = {}) {
  for (const [name, holder] of methodsFrom(target.constructor.prototype)) {
    if (include ? !fits(name, include) : exclude !== undefined && fits(name, exclude)) continue
    if (typeof Reflect.getOwnPropertyDescriptor(holder, name)?.value === "function") target[name] = target[name].bind(target)
  }
  return target
}
const kept: (() => string)[] = []
class Base { base() { return "base of " + (this as any).name } }
class App extends Base {
  name = "app"
  constructor() { super(); bindMethods(this); kept.push(this.stop, this.base) }
  stop() { return "stopped " + this.name }
  get size() { return 1 }
}
const app = new App()
console.log((app as any).constructor === App, (app as any).constructor.prototype === Object.getPrototypeOf(app), App.prototype === Object.getPrototypeOf(app))
console.log(kept.map(f => f()).join(), Object.keys(app).join(), app.size)
// The bound method is read in another method, put in an object, and called as a method of that object.
class View {
  name = "view"
  constructor() { bindMethods(this) }
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
// Only some of the methods are bound: by name, by pattern, and a method whose name is a symbol.
class Picky {
  constructor(choice?: { include?: Pattern[]; exclude?: Pattern[] }) { bindMethods(this, choice) }
  onOpen() { return "open" }
  onClose() { return "close" }
  render() { return "render" }
  [Symbol.toPrimitive]() { return "primitive" }
}
const own = (object: object) => "[" + Reflect.ownKeys(object).map(String).join() + "]"
console.log(own(new Picky({ include: ["render", /^onC/] })), own(new Picky({ exclude: [/^on/] })), own(new Picky({ include: [] })), own(new Picky({ exclude: [Symbol.toPrimitive, "render"] })), own(new Picky({})), own(new Picky()))
