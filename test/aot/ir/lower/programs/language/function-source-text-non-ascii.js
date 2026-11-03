// RUN: lower
// OPTIONS: builtin-modules

// The source text of a function that contains characters outside ASCII evaluates to a function with the same result. Plain Bun may escape such characters in the text, so the results are compared and the text is not printed.
function latin1String() { return "é"; }
function wideString() { return "é→😀"; }
function template() { return `é→😀${1 + 1}`; }
function café() { return "identifier"; }
function regExp() { return /→+/u.exec("a→→b")[0]; }
function comment() { /* é→😀 */ return "comment"; }
const arrow = () => "ü→";
function ascii() { return "ascii"; }

for (const f of [latin1String, wideString, template, café, regExp, comment, arrow, ascii]) {
  const evaluated = (0, eval)("(" + f + ")");
  console.log(f.name + ":", f(), evaluated() === f());
}

// GENERATED: template regExp arrow
// CHECK-LABEL: function {{*}}name="template"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="\u{e9}\u{2192}\u{1f600}"
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = ToString v1
// CHECK-NEXT: v3 = Strcat v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="regExp"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRegExp pattern="\\u2192+" regExpFlags=[Unicode]
// CHECK-NEXT: v1 = PropGet v0 key="exec"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="a\u{2192}\u{2192}b"
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="exec" calleeName="exec"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = ElemGet v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="\u{fc}\u{2192}"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
