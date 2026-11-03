// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: isSame show
// CHECK-LABEL: function {{*}}name="isSame"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = PropGet v1 key="join"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Call v10, v1, v11 calleeKey="join" calleeName="values.join"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Call v6, v4, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
