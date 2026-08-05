import { $ } from "bun";
const [tsv, bin] = process.argv.slice(2);
const rows = (await Bun.file(tsv).text()).trim().split("\n").map(l => { const [size, cw, off, fr] = l.split("\t"); return { size: +size, cw: +cw, off: +off, frames: (fr || "").split(";") }; }).filter(r => r.cw > 0);
const addrs = [...new Set(rows.flatMap(r => r.frames))];
const sym = new Map<string, string>();
for (let i = 0; i < addrs.length; i += 400) { const chunk = addrs.slice(i, i + 400); const out = await $`atos -o ${bin} -l 0x100000000 ${chunk}`.text(); out.trim().split("\n").forEach((s, j) => sym.set(chunk[j], s.replace(/ \(in .*?\)/, "").replace(/\(.*/, "").trim())); }
const skip = /^(mi_|_mi_|WTF::fast|WTF::tryFast|WTF::FastMalloc|operator new|malloc|calloc|realloc|WTF::Vector|WTF::VectorBuffer|WTF::RefCounted|WTF::ThreadSafeRefCounted|std::__1|0x|JSC::GCClient|WTF::StringImpl::create|WTF::StringImpl::tryCreate|_RNvMs._NtCs.*alloc7raw_vec|_R.*bun_alloc|WTF::Ref<WTF::StringImpl|WTF::String::String|WTF::StringBuilder|WTF::tryMakeString|WTF::makeString)/;
const agg = new Map<string, { n: number; bytes: number; offs: Map<number, number>; cws: number }>();
for (const r of rows) {
  const names = r.frames.map(a => sym.get(a) || a);
  const owner = (names.find(n => !skip.test(n)) || names[0]).slice(0, 100);
  const e = agg.get(owner) || { n: 0, bytes: 0, offs: new Map(), cws: 0 };
  e.n++; e.bytes += r.size; e.cws += r.cw; e.offs.set(r.off, (e.offs.get(r.off) || 0) + 1);
  agg.set(owner, e);
}
console.log("changed sampled image blocks by owner (n, bytes, avg changed words, firstOff histogram)");
for (const [o, e] of [...agg].sort((a, b) => b[1].n - a[1].n).slice(0, 35)) {
  const offs = [...e.offs].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `+${k}:${v}`).join(" ");
  console.log(String(e.n).padStart(4), (e.bytes / 1024).toFixed(0).padStart(6) + "K", (e.cws / e.n).toFixed(1).padStart(6), " ", o.padEnd(100), offs);
}
