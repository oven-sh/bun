// A long string is built with `+=` in a loop and then hashed.
let src = ""; for (let i = 0; i < 2000; i++) src += `let v_${i % 97} = foo_${i % 13}(a${i % 7} + ${i} * bar) - 12;\n`
console.log(src.length)
let h = 0
for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0
console.log(h)
const m = new Map<string, number>()
for (let i = 0; i < 1000; i++) { const k = "k" + (i % 10); m.set(k, (m.get(k) ?? 0) + 1) }
console.log(m.size, m.get("k3"), m.get("zz"), m.has("k9"), m.has("q"))
