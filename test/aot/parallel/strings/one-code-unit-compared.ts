// A single character read from a string is compared with one-character literals, ASCII or not.
// CALLS- wideCases TypedString|StringsAreEqual|StringHasAt|StringEq
// CALLS+ wideCases equality with .*\b233\b
// CALLS- byCharAt TypedString|StringsAreEqual|StringHasAt|StringEq|StringEqualsLiteral
// CALLS- byAt TypedString|StringsAreEqual|StringHasAt|StringEq|StringEqualsLiteral
// CALLS- byIndex TypedString|StringsAreEqual|StringHasAt|StringEq|StringEqualsLiteral
// CALLS+ twoUnits TypedString|StringsAreEqual|StringHasAt|StringEq
// CALLS+ unknownCases : [1-6][0-9][0-9] instructions
// JSCALLS+ unknownCases : [1-6][0-9][0-9] instructions
// JSCALLS+ wideCases equality with .*\b2047\b
const say: (s: string) => void = (globalThis as any).print ?? console.log
function wideCases(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    switch (s[i]) {
      case " ": n += 1; break
      case " ": n += 10; break
      case "é": n += 100; break
      case "\ud835": n += 1000; break
      case "\udc00": n += 10000; break
      case "a": n += 100000; break
      case "߿": n += 1000000; break
      case "ࠀ": n += 10000000; break
      case "￿": n += 100000000
    }
  }
  return n
}
function byCharAt(s: string, i: number): number { const c = s.charAt(i | 0); return c === " " ? 1 : c === "é" ? 2 : c === "a" ? 3 : c === "" ? 4 : 0 }
function byAt(s: string, i: number): number { const c = s.at(i | 0); return c === " " ? 1 : c === "é" ? 2 : c === "a" ? 3 : c === undefined ? 4 : 0 }
function byIndex(s: string, i: number): number { const c = s[i | 0]; return " " === c ? 1 : "é" === c ? 2 : "a" === c ? 3 : c === undefined ? 4 : 0 }
function twoUnits(s: string, i: number): boolean { return s[i] === "\u{1d400}" }
function differs(s: string, i: number): boolean { return s[i] !== " " }
function unknownCases(x: any): number { let n = 0; for (let i = 0; i < x.length; i++) { switch (x[i]) { case "a": n += 1; break; case "Ā": n += 1000000; break; case " ": n += 10; break; case "é": n += 100; break; case "\ud835": n += 1000; break; case "a": n += 100000 } } return n }
function unknownOutside(x: any, i: any): string { switch (x[i]) { case "a": return "a"; case " ": return "ls"; case "é": return "e"; default: return "other" } }
function looselyWithNumber(s: string, i: number): string { const c: any = s[i]; return (c == 5) + ":" + (c == "5") + ":" + (c == " ") + ":" + (c == undefined) + ":" + (c == null) }
function ofAnything(x: any, i: any): string { const c = x[i]; return (c === " ") + ":" + (c === "a") + ":" + (c === "é") + ":" + (c === undefined) }
function everyCase(s: string, i: number): string { switch (s[i]) { case "a": return "a"; case "é": return "e"; case " ": return "ls"; case " ": return "ps"; case "\ud835": return "lead"; case "\udc00": return "trail"; case "￿": return "last"; case undefined: return "undefined"; default: return "other" } }
const subjects = ["a  é", "éaé", "x\u{1d400}y", "\ud835", "\udc00\ud835", "߿ࠀ￿", "", "aaaa", " ".repeat(3) + "a", ("z " + "q").slice(1), ("éé" + "a").slice(1)]
for (const s of subjects) {
  const row: (number | boolean)[] = [wideCases(s)]
  for (const i of [0, 1, 2, -1, 99]) row.push(byCharAt(s, i), byAt(s, i), byIndex(s, i), twoUnits(s, i), differs(s, i))
  say(row.join(" "))
}
for (const s of subjects) say([0, 1, 2, 3, -1, 99, 0.5, NaN].map(i => everyCase(s, i)).join(" ") + " | " + [0, 1, 99].map(i => looselyWithNumber(s, i)).join(" "))
say([looselyWithNumber("5 ", 0), looselyWithNumber("5 ", 1), looselyWithNumber("5 ", 2)].join(" "))
for (const x of ["a ", new String("a "), ["a", " ", "ab", "  "], ["é", 5, undefined, null], { 0: " ", 1: "a" }, new Map(), 5, true])
  say([0, 1, 2, 3, "0", "length"].map(i => ofAnything(x, i)).join(" "))
const anything: any[] = ["aĀbĀ", "a aé", "aaa", "éé", ("a " + "xyz").slice(0, 2), "ro" + "a ".repeat(2), "\ud835" + "a", new String("a "), ["a", " ", "aa", 5, undefined, null, "é", ["a"]], { length: 3, 0: "a", 2: " " }, new Uint8Array([97, 1]), "", []]
say(anything.map(unknownCases).join(" "))
for (const x of anything) say([0, 1, 2, -1, 99, 0.5, "0", "length"].map(i => unknownOutside(x, i)).join(" "))
;(globalThis as any).kept = [wideCases, byCharAt, byAt, byIndex, twoUnits, unknownCases, unknownOutside]
