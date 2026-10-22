// A typed object serves as the prototype of another object.
const base = { greeting: "hello", count: 1 }
const derived = Object.create(base)
derived.own = true
console.log(derived.greeting, derived.count, derived.own, Object.getPrototypeOf(derived) === base, "greeting" in derived, Object.keys(derived).join())
base.count = 2
console.log(derived.count)
derived.count = 5
console.log(derived.count, base.count)
class Point { constructor(public x: number, public y: number) {} sum() { return this.x + this.y } }
const p = new Point(1, 2)
const q = Object.create(p)
console.log(q.x, q.y, q instanceof Point, p.sum())
const many: unknown[] = []
for (let i = 0; i < 20000; i++) many.push(Object.create({ i }))
console.log((many[19999] as any).i)
// The prototype of a compiled object is not changed where JavaScript refuses it too. Where JavaScript changes it: type-rules/typed-object-prototype-changes.
const parent = { inherited: "yes", hello() { return "hi " + (this as any).a } }
try { Object.setPrototypeOf(parent, Object.create(parent)); console.log("no cycle found") } catch (e) { console.log((e as Error).name) }
const sealed = Object.preventExtensions({ b: 2 })
try { Object.setPrototypeOf(sealed, parent); console.log("changed") } catch (e) { console.log((e as Error).name) }
// A method of Object.prototype is shadowed on a compiled object, by a name that is not known at compile time.
const shadowing: Record<string, unknown> = { kept: 1 }
for (const key of ["toString", "valueOf", "hasOwnProperty"]) shadowing[key] = () => "mine " + key
console.log(String((shadowing.toString as () => string)()), Object.keys(shadowing).join(), `${shadowing}`)
const withSetter = Object.create({ set seen(v: number) { (this as any).stored = v * 2 } }) as any
const child: any = { own: 1 }
Object.setPrototypeOf(child, withSetter)
child.seen = 21
console.log(child.stored, Object.keys(child).join())
