// A value that was checked against its type where it was created keeps that type although a type guard later narrows a variable for it to another type.
type Child = { d: PropertyDescriptor | null }
type Alike = { get: () => string }
function guard(d: PropertyDescriptor): d is PropertyDescriptor & { get(): string } { return typeof d.get === "function" }
function tell(child: Child): string {
  const once = () => {
    const s = child.d!
    if (guard(s)) { return "get " + s.get() } else { return "none " + s.value }
  }
  return once()
}
const alike = JSON.parse('{}') as Alike
const given = JSON.parse('{"d":{"value":"v"}}') as Child
console.log(typeof alike.get, tell(given), tell({ d: { get: () => "g" } }))
