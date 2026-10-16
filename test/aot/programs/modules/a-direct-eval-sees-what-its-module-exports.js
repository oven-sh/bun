// A declaration that begins with `export` is a variable of the module like any other: a direct eval reads it and stores to it.
export const limit = 5
export function double(n) {
  return n * 2
}
export class Box {}
export let count = 0
export var old = "old"
export default function named() {
  return 1
}
export function read() {
  return count
}
const listed = "listed"
export { listed }
console.log(eval("typeof limit"), eval("typeof double"), eval("typeof Box"), eval("typeof count"), eval("typeof old"), eval("typeof named"), eval("typeof listed"))
console.log(eval("limit"), eval("double(limit)"), eval("new Box() instanceof Box"), eval("named()"))
eval("count = 5")
eval("old += '!'")
console.log(read(), count, old)
try {
  eval("limit = 6")
} catch (error) {
  console.log(error.name, limit)
}
function inside() {
  const limit = "shadowed"
  return [eval("limit"), eval("count++"), (() => eval("double(count)"))()]
}
console.log(inside().join(), count)
