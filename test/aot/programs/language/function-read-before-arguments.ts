// In a call the function is read before the arguments are evaluated.
function run(o: any, store: boolean): string {
  let a!: number
  if (store) a = 1
  return o.method(a)
}
const first = { get method() { console.log("the getter ran"); return (x: unknown): string => "called with " + x } }
const second = { method(x: unknown): string { return "the other, with " + x } }
const third = JSON.parse('{"method":1}')
console.log(run(first, true), run(second, true))
for (const o of [first, second, third]) {
  try { console.log(run(o, false)) } catch (e) { console.log((e as Error).constructor.name) }
}
