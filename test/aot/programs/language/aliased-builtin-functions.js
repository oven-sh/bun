// Some built-in functions are one object under two names. Both names compare equal, read from the holder, from an instance or through a variable.
const show = (label, ...values) => console.log(label + ": " + values.join(" "))

show("trim", String.prototype.trimLeft === String.prototype.trimStart, String.prototype.trimRight === String.prototype.trimEnd)
show("trim on a string", "".trimLeft === "".trimStart, "".trimRight === "".trimEnd)
show("array", Array.prototype.values === Array.prototype[Symbol.iterator], [].values === [][Symbol.iterator])
show("map", Map.prototype.entries === Map.prototype[Symbol.iterator], new Map().entries === new Map()[Symbol.iterator])
show("set", Set.prototype.keys === Set.prototype.values, Set.prototype.values === Set.prototype[Symbol.iterator], Set.prototype.keys === Set.prototype[Symbol.iterator])
show("typed array", Uint8Array.prototype.values === Uint8Array.prototype[Symbol.iterator], Uint8Array.prototype.toString === Array.prototype.toString)
show("date", Date.prototype.toGMTString === Date.prototype.toUTCString)
show("number", Number.parseInt === parseInt, Number.parseFloat === parseFloat)
show("disposable stack", DisposableStack.prototype.dispose === DisposableStack.prototype[Symbol.dispose])
show("async disposable stack", AsyncDisposableStack.prototype.disposeAsync === AsyncDisposableStack.prototype[Symbol.asyncDispose])

show("other functions", String.prototype.trimStart === String.prototype.trimEnd, Array.prototype.values === Array.prototype.keys, Number.parseInt === parseFloat)
show("other holders", Array.prototype.values === Uint8Array.prototype.values, Map.prototype.entries === Set.prototype.entries, Map.prototype.values === Set.prototype.values)

function isSame(a, b) { return a === b }
const tests = { isSame }
show("through a call", tests.isSame(Number.parseInt, parseInt), tests.isSame(Set.prototype.keys, Set.prototype.values), tests.isSame(parseInt, parseFloat))

const names = new Map([[parseInt, "parseInt"], [String.prototype.trimStart, "trimStart"], [Array.prototype.values, "values"]])
show("as a key", names.get(Number.parseInt), names.get(String.prototype.trimLeft), names.get(Array.prototype[Symbol.iterator]), names.get(Number.parseFloat))

switch (Number.parseFloat) {
  case parseInt: show("switch", "parseInt"); break
  case parseFloat: show("switch", "parseFloat"); break
  default: show("switch", "neither")
}

show("calls", JSON.stringify(" a ".trimLeft()), JSON.stringify(" a ".trimRight()), Number.parseInt("12px"), Number.parseInt("ff", 16), Number.parseFloat("1.5x"))
show("calls", new Date(0).toGMTString(), [...new Set([1, 2]).keys()], [...new Map([[1, 2]])[Symbol.iterator]()], [...[3, 4][Symbol.iterator]()])
show("calls", Uint8Array.of(1, 2).toString(), [...Uint8Array.of(1, 2).values()], [...Uint8Array.of(3)[Symbol.iterator]()])

const parse = Number.parseInt, trim = String.prototype.trimLeft
show("values called", parse("7.9"), JSON.stringify(trim.call("  b ")), Number.parseInt.name, String.prototype.trimLeft.name, Set.prototype.keys.name)
