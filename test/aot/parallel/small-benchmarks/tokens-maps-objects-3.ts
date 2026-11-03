// Strings, Maps and small objects, closer to what application code does (part 3).
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
function count(toks: Tok[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of toks) if (t.kind === "id") m.set(t.text, (m.get(t.text) ?? 0) + 1)
  return m
}
const t0 = performance.now()
let src = ""; for (let i = 0; i < 2000; i++) src += `let v_${i % 97} = foo_${i % 13}(a${i % 7} + ${i} * bar) - 12;\n`
let total = 0
for (let r = 0; r < 200; r++) { const m = count(lex(src)); total += m.size + (m.get("bar") ?? 0) }
console.log("strs", total, (performance.now() - t0).toFixed(0) + "ms")
