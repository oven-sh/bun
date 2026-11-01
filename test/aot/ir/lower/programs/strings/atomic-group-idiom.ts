// RUN: lower
// OPTIONS: builtin-modules

// The regular-expression idiom for an atomic group, `(?=(X))\N`, and every similar form that is not that idiom.
declare const console: { log(...args: unknown[]): void }
const expressions: RegExp[] = [
  /(?=(a+))\1b/, /(?=(a+))\1b/i, /(?=(a+))\1b/u, /(?=(a+))\1b/iu, /(?=(a+))\1b/giu, /(?=(a+))\1b/y,
  /(?=(a*))\1b/iu, /(?=([\s._-]*))\1x/giu, /x(?=([\s\u{200b}-\u{200f}._-]*))\1y(?=([\s\u{200b}-\u{200f}._-]*))\2z/giu, /(?=([a-z\u{430}-\u{44f}\u{1d400}-\u{1d419}]+))\1!/giu,
  /(?:(?=(a+))\1b)*c/iu, /(?:(?=(a+))\1|b)+c/iu, /(?=((?:ab)+))\1a/iu, /(?=((a)|(b)))\1\2/iu, /(?=((a+)(b*)))\1c/iu, /^(?=(.*))\1$/iu, /(?=(\p{L}+))\1\p{N}/giu, /(?=(k+))\1s/iu, /(?=([\u{212a}k]+))\1s/iu,
  /(?=(a+))\1.\1/iu, /(?=(a+))\1\1/iu, /(a)(?=(b+))\1/iu, /(a)(?=(b+))\2\1/iu, /(?!(a+))\1b/iu, /(?=(a+)|b)\1b/iu, /(?=(a+)b)\1b/iu, /(?=b(a+))\1/iu, /(?=(a+)?)\1b/iu, /(?=(a+){2})\1b/iu, /(?=(?:a+))b|(?=(a))\1/iu,
  /(?=(a+))\1*b/iu, /(?=(a+))\1+b/iu, /(?=(a+))\1?b/iu, /(?=(a+))\1{2}b/iu, /(?=(a+))\1*?b/iu, /(?=(?<n>a+))\k<n>b/iu, /(?=(?<n>a+))\1b/iu, /(?<=(?=(a+))\1)b/iu, /(?<=x)(?=(a+))\1b/iu, /(?=(a+))(?:)\1b/iu, /(?=(a+))\b\1b/iu,
  /(?=(a+))?\1b/, /(?=(a+))*\1b/i, /(?=(a+)){0}\1b/i, /(?=(é+))\1b/i, /(?=(é+))\1b/iu, /(?=(Ж+))\1b/i, /(?=(Ж+))\1b/iu, /(?=(𝐀+))\1b/u, /(?=(𝐀+))\1b/i, /(?=([^]*?))\1b/iu, /(?=(a+?))\1b/iu,
]
const subjects: string[] = ["", "b", "ab", "aab", "AAb", "aAaB", "aaa", "aaab aab", "xaab", "ababa", "abab", "aabc", "aabaabc", "bbc", "ac", "aaabbc", "x y z", "x._-y  z", "x​y‎‏z", "x​​", "абв!", "АБ!", "𝐀𝐁!", "𝐀", "abc1", "жж7", "kks", "KKks", "Ks", "ſs", "aaxaa", "aaxAA", "aaaa", "ab", "abb", "abba", "ééb", "Ééb", "Жжb", "жЖB", "𝐀𝐀b", "\ud835b", "a\nb", "│ aab │", "│ AAB", "│x . y-z"]
function show(m: RegExpExecArray | null): string { return m === null ? "-" : m.index + ":" + JSON.stringify(Array.from(m)) }
let rows = 0
for (let e = 0; e < expressions.length; e++) {
  const r = expressions[e]
  let line = ""
  for (const s of subjects) {
    r.lastIndex = 0
    const first = show(r.exec(s)), at = r.lastIndex
    const second = r.global || r.sticky ? show(r.exec(s)) : ""
    r.lastIndex = 0
    line += " " + first + (at ? "@" + at : "") + second + "|" + JSON.stringify(s.replace(r, "<$&,$1>")) + (r.test(s) ? "t" : "f")
    r.lastIndex = 0
  }
  rows++
  console.log(e + " /" + r.flags + " ->" + line)
}
console.log(rows + " rows")

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = String string="-"
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = PropGet v4 key="index"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Builtin builtin=JSON
// CHECK-NEXT: v10 = PropGet v9 key="stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=Array
// CHECK-NEXT: v13 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v14 = Call v13, v12, v4 calleeName="Array.from"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = Call v11, v9, v15 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Add v8, v17
// CHECK-NEXT: Jump -> next b6(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
