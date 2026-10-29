// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: InvalidRegExpLiteral 4

// Regular expression literals that JavaScript rejects stop the build of a JavaScript file too, also in a function that is never called.
function unused() {
  return [
    /\1/u,
    /a**/,
    /(?<a>.)\k<b>/,
    /[b-a]/,
  ];
}
console.log(typeof unused);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = TypeOf v1
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unused"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|RegExp> flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRegExp pattern="\\1" regExpFlags=[Unicode]
// CHECK-NEXT: v1 = NewRegExp pattern="a**"
// CHECK-NEXT: v2 = NewRegExp pattern="(?<a>.)\\k<b>"
// CHECK-NEXT: v3 = NewRegExp pattern="[b-a]"
// CHECK-NEXT: v4 = NewArray v0, v1, v2, v3 contents=undefined|null|RegExp
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|RegExp> flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
