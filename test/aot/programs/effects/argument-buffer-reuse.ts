// Compiled code passes lists to the runtime and takes extra results back through one buffer in its frame.
// Each function uses the buffer twice in a row: the first call must see what was stored for it, and the second must not return what the first one stored.
function twoTemplates(a: number, b: number, c: number, d: number): string {
  const first = `${a}:${b}:${a + b}`
  const second = `${c}:${d}:${c + d}`
  return first + "|" + second
}

function threeTemplates(a: number, b: boolean, c: number | undefined): string {
  const first = `${a}/${b}/${c}`
  const second = `${c}/${a}/${b}`
  const third = `${b}/${c}/${a}`
  return first + "|" + second + "|" + third
}

function templateThenSplit(a: number, b: number, text: string, separator: string): string {
  const label = `${a}:${b}`
  const [head, next, last] = text.split(separator)
  return label + "|" + head + "|" + next + "|" + last
}

function templateThenSplitAtLiteral(a: number, b: number, text: string): string {
  const label = `${a}:${b}`
  const [head, next] = text.split(", ")
  return label + "|" + head + "|" + next
}

function templateThenExec(a: number, b: number, text: string): string {
  const label = `${a}:${b}`
  const [whole, left, right] = /(\d+)-(\d+)/.exec(text) ?? []
  return label + "|" + whole + "|" + left + "|" + right
}

function templateThenMatch(a: number, b: number, text: string): string {
  const label = `${a}:${b}`
  const [whole, word] = text.match(/([a-z]+)$/) ?? []
  return label + "|" + whole + "|" + word
}

function templateThenDescriptor(a: number, b: number, object: object, key: string): string {
  const label = `${a}:${b}`
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) return label + "|none"
  return label + "|" + descriptor.value + "|" + descriptor.writable + "|" + descriptor.enumerable + "|" + descriptor.configurable + "|" + typeof descriptor.get
}

function templateThenEntries(a: number, b: number, map: Map<string, number>, set: Set<string>): string {
  let text = ""
  for (const [key, value] of map) {
    const label = `${a}:${b}:${value}`
    text += label + "=" + key + ";"
  }
  for (const member of set) {
    const label = `${b}:${a}`
    text += label + "=" + member + ";"
  }
  return text
}

function restAfterTemplate(a: number, ...rest: number[]): string {
  const label = `${a}:${rest.length}`
  return label + "|" + rest.join("+")
}

const frozen = Object.freeze({ x: 1 })
const withGetter = { get y() { return 2 } }
const map = new Map([["one", 1], ["two", 2], ["three", 3]])
map.delete("two")
map.set("four", 4)
const set = new Set(["p", "q", "r"])
set.delete("p")

for (let i = 0; i < 4; i++) {
  console.log(twoTemplates(i, i + 1, i + 2, i + 3))
  console.log(threeTemplates(i + 0.5, i % 2 === 0, i % 3 === 0 ? undefined : i))
  console.log(templateThenSplit(i, -i, "a" + i + "--b--c--d", "--"))
  console.log(templateThenSplit(i, -i, "only" + i, "--"))
  console.log(templateThenSplitAtLiteral(i, -i, "x" + i + ", y, z"))
  console.log(templateThenSplitAtLiteral(i, -i, "nothing"))
  console.log(templateThenExec(i, -i, "at " + i + "0-2" + i + " end"))
  console.log(templateThenExec(i, -i, "no digits"))
  console.log(templateThenMatch(i, -i, "12 tail"))
  console.log(templateThenMatch(i, -i, "tail 12"))
  console.log(templateThenDescriptor(i, -i, frozen, "x"))
  console.log(templateThenDescriptor(i, -i, withGetter, "y"))
  console.log(templateThenDescriptor(i, -i, [i], "length"))
  console.log(templateThenDescriptor(i, -i, frozen, "missing"))
  console.log(templateThenEntries(i, -i, map, set))
  console.log(restAfterTemplate(i, 1, 2, 3, 4, 5, 6, 7, 8, 9))
}
