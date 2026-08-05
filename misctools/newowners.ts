// bucket new-payload.tsv (post-restore live sampled blocks) by owner frame; each sample ~= RATE bytes of allocation volume, so report counts*RATE as est. bytes
import { $ } from "bun";
const [tsv, bin, rateArg] = process.argv.slice(2); const RATE = +(rateArg || 32768);
const rows = (await Bun.file(tsv).text()).trim().split("\n").filter(Boolean).map(l => { const [size, , , fr] = l.split("\t"); return { size: +size, frames: (fr || "").split(";") }; });
const addrs = [...new Set(rows.flatMap(r => r.frames))];
const sym = new Map<string, string>();
for (let i = 0; i < addrs.length; i += 400) { const chunk = addrs.slice(i, i + 400); const out = await $`atos -o ${bin} -l 0x100000000 ${chunk}`.text(); out.trim().split("\n").forEach((s, j) => sym.set(chunk[j], s.replace(/ \(in .*?\)/, "").replace(/\(.*/, "").trim())); }
const skip = /^(mi_|_mi_|WTF::fast|WTF::tryFast|WTF::FastMalloc|operator new|malloc|calloc|realloc|WTF::Vector|WTF::VectorBuffer|WTF::RefCounted|std::__1|0x|JSC::GCClient|WTF::StringImpl::create|WTF::StringImpl::tryCreate|_R.*alloc7raw_vec|_R.*bun_alloc|WTF::String::String|WTF::StringBuilder|WTF::tryMakeString|WTF::makeString|bmalloc|pas_|Gigacage::|JSC::MarkedBlock::tryCreate|JSC::.*AlignedMemoryAllocator|JSC::BlockDirectory|JSC::LocalAllocator|JSC::CompleteSubspace|JSC::IsoSubspace|JSC::Subspace|JSC::allocateCell|JSC::tryAllocateCell|WTF::HashTable<.*>::(rehash|expand|add|allocateTable)|_RNvXs.*core3ops|WTF::Detail::|_platform_mem|_malloc_zone|_Zn)/;
const agg = new Map<string, { n: number; bytes: number }>();
let tot = 0;
for (const r of rows) {
  const names = r.frames.map(a => sym.get(a) || a);
  let owner = (names.find(n => !skip.test(n)) || names[0] || "?").slice(0, 110);
  const e = agg.get(owner) || { n: 0, bytes: 0 }; e.n++; e.bytes += r.size; agg.set(owner, e); tot++;
}
console.log(`post-restore live sampled blocks: ${tot} (~${(tot * RATE / 1048576).toFixed(1)}MB allocation volume est.)`);
for (const [o, e] of [...agg].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(String(e.n).padStart(4), `~${(e.n * RATE / 1024).toFixed(0)}K`.padStart(8), o);
