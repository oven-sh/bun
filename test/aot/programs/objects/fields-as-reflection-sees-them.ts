// The fields of a typed object as reflection sees them: descriptors, enumerability, order.
interface Command { name: string; description: string; hidden: boolean; count: number }
function command(name: string, dynamic: boolean): Command {
  const made: Command = { name, description: dynamic ? "" : "static " + name, hidden: false, count: 1 }
  return made
}
const a = command("a", true), b = command("b", false)
console.log(a.description, a.description, b.description, Object.keys(a).join(), JSON.stringify(a), JSON.stringify(b))
console.log(Object.keys(b).join(), b.hidden, JSON.stringify(b), Object.getOwnPropertyNames(b).join())
b.hidden = true
b.count += 2
console.log(b.hidden, b.count, JSON.stringify({ ...b }), JSON.stringify({ ...a }))
a.count = 4
console.log(a.count, JSON.stringify(Object.getOwnPropertyDescriptor(a, "name")), typeof Object.getOwnPropertyDescriptor(a, "count")!.get)
console.log("count" in a, Object.keys(a).join())
class Point { x = 1; y = 2; sum() { return this.x + this.y } }
const p = new Point()
console.log(p.sum(), p.x, Object.keys(p).join())
