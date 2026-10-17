// A `var`, or a variable declared without an initializer, can hold `undefined` whatever its declared type.
const text = (value: unknown) => String(value)
const show = (...values: unknown[]) => console.log(values.map(text).join(" "))
enum Target { ES5, ES2015 }

// variables had their room; then it was, and they lost it.
function binder() {
  var depth = 0
  var version = 0 as Target
  var enabled = false
  var list = [0]
  function bind(start: number) {
    depth = start * 2; version = Target.ES2015; enabled = true; list = [start]
    const seen = [depth + 1, version | 4, enabled, list.length]
    depth = undefined!; version = undefined!; enabled = undefined!; list = null!
    return seen
  }
  const state = () => [text(depth), text(version), text(enabled), text(list)]
  return { bind, state }
}
const b = binder()
show(...b.state()); show(...b.bind(1)); show(...b.state()); show(...b.bind(2)); show(...b.state())

// Declared without a value, captured: another function clears them.
function session(start: number) {
  var position: number
  var isStrict: boolean
  var target: Target
  let count: number
  const clear = () => { position = undefined!; isStrict = undefined!; target = undefined!; count = undefined! }
  position = start; isStrict = start > 1; target = Target.ES2015; count = start + 1
  const before = [position + 1, isStrict, target | 2, count + 1]
  clear()
  return [...before, text(position), text(isStrict), text(target), text(count)]
}
show(...session(1)); show(...session(2))

// Not captured: one function declares, stores, reads and clears.
function local(start: number) {
  var position: number
  var isStrict: boolean
  var target: Target
  var depth = 0
  var version = Target.ES5
  let count: number
  position = start; isStrict = true; target = Target.ES2015; depth = start; version = Target.ES2015; count = start
  const sum = position + depth + target + version + count
  position = undefined!; isStrict = undefined!; target = undefined!; depth = undefined!; version = undefined!; count = undefined!
  return [sum, text(position), text(isStrict), text(target), text(depth), text(version), text(count)]
}
show(...local(3))

// Of the module.
var moduleDepth = 0
var moduleTarget = Target.ES5
function enter() { moduleDepth++; moduleTarget = Target.ES2015; return moduleDepth + moduleTarget }
function leave() { moduleDepth = undefined!; moduleTarget = undefined! }
show(enter(), enter()); leave(); show(text(moduleDepth), text(moduleTarget)); moduleDepth = 5; show(enter())

// In parentheses.
function wrapped() { var n = 1; const read = () => text(n); const first = read(); n = (undefined!); return [first, read()] }
show(...wrapped())
// Not cleared: it stays an integer.
function counter() { var n = 0; const bump = () => ++n; bump(); bump(); return n }
show(counter())
