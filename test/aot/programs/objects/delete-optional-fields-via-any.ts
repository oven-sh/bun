// `delete` of optional fields through a receiver of type `any`.
function normalize(given: any) {
  const params = given
  if (!params) return {}
  if (params?.message !== undefined) params.error = params.message
  delete params.message
  return params
}
function byKey(o: any, k: string) { delete o[k]; return o }
class Box { width = 1; height?: number = 2; label?: string = "b"; area() { return this.width * (this.height ?? NaN) } }
const a: { message?: string; error: string | undefined; code: number } = { message: "m", error: undefined, code: 7 }
const b: { message?: string; code: number; nested: { message?: string; keep: boolean } } = { message: "n", code: 8.5, nested: { message: "inner", keep: true } }
console.log(JSON.stringify(normalize(a)), "message" in a, a.message, Object.keys(a).join(), a.code + 1)
console.log(JSON.stringify(normalize(b)), JSON.stringify(normalize(b.nested)), b.code * 2, b.nested.keep)
const box = new Box()
console.log(JSON.stringify(byKey(box, "height")), box.area(), box.height, Object.hasOwn(box, "height"), box.label?.length)
box.height = 5
console.log(box.area(), JSON.stringify(box), Reflect.deleteProperty(box, "label"), box.label, Object.keys(box).join())
const frozen = Object.freeze({ message: "f" })
try { normalize(frozen) } catch (e) { console.log((e as Error).constructor.name) }
console.log(frozen.message)
