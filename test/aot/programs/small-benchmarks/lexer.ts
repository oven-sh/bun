// A small lexer: string scanning and object allocation.
interface Tok { kind: string; text: string; pos: number }
function lex(src: string): Tok[] {
  const out: Tok[] = []; let i = 0
  while (i < src.length) {
    const c = src.charCodeAt(i)
    if (c === 32 || c === 10) { i++; continue }
    const start = i
    if ((c >= 97 && c <= 122) || c === 95) { while (i < src.length) { const d = src.charCodeAt(i); if (!((d >= 97 && d <= 122) || d === 95 || (d >= 48 && d <= 57))) break; i++ } out.push({ kind: "id", text: src.slice(start, i), pos: start }) }
    else if (c >= 48 && c <= 57) { while (i < src.length && src.charCodeAt(i) >= 48 && src.charCodeAt(i) <= 57) i++; out.push({ kind: "num", text: src.slice(start, i), pos: start }) }
    else { i++; out.push({ kind: "op", text: src[start]!, pos: start }) }
  }
  return out
}
const toks = lex("let v_1 = foo_2(a3 + 45 * bar) - 12;\n")
console.log(toks.length)
let s = ""
for (const t of toks) s += t.kind + ":" + t.text + "@" + t.pos + " "
console.log(s)
let n = 0
for (let r = 0; r < 20000; r++) { const ts = lex("let v_1 = foo_2(a3 + 45 * bar) - 12;\n"); for (const t of ts) if (t.kind === "id") n += t.text.length + t.pos }
console.log(n)
