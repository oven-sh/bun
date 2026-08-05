// aggregate imagetrap.tsv: first-write faults into image pages, by writer callsite (symbolized), split cell/payload
import { $ } from "bun";
const [tsv, bin] = process.argv.slice(2);
const rows = (await Bun.file(tsv).text()).trim().split("\n").map(l => { const [page, kind, pcs] = l.split("\t"); return { page, kind, pcs: pcs.split(";").filter(x => x !== "0") }; });
const addrs = [...new Set(rows.flatMap(r => r.pcs))].filter(a => parseInt(a, 16) < 0x300000000);
const sym = new Map<string, string>();
for (let i = 0; i < addrs.length; i += 500) { const chunk = addrs.slice(i, i + 500).map(a => "0x" + a); const out = await $`atos -o ${bin} -l 0x100000000 ${chunk}`.text(); out.trim().split("\n").forEach((s, j) => sym.set(chunk[j].slice(2), s.replace(/ \(in .*?\)/, "").replace(/^(.{0,110}).*?( \([^()]*\))?$/, "$1$2").trim())); }
const skip = /^(0x|WTF::RefCounted|WTF::ThreadSafeRefCounted|WTF::Ref<|WTF::RefPtr<|std::__1|imageTrapHandler|_sigtramp|WTF::Lock::|WTF::Locker|JSC::JSLock|WTF::StringImpl::deref|WTF::StringImpl::ref|WTF::String::~?String|WTF::fastFree|mi_free|WTF::Vector<.*>::(append|expand|reserve|shrink|~Vector|Vector)|bmalloc|WTF::HashTable<.*>::(rehash|add|remove|expand|deallocateTable|allocateTable))/;
const name = (a: string) => sym.get(a) || (parseInt(a, 16) >= 0x300000000 ? "<jit>" : a);
const byOwner = new Map<string, { n: number; cell: number; payload: number; other: number; ex: string }>();
for (const r of rows) {
  const names = r.pcs.map(name);
  let owner = names.find(n => !skip.test(n) && n !== "<jit>") || names[0] || "?";
  owner = owner.replace(/\(.*?\)\s*(\(|$)/, " $1").slice(0, 120);
  const e = byOwner.get(owner) || { n: 0, cell: 0, payload: 0, other: 0, ex: names.slice(0, 5).join(" < ").slice(0, 300) };
  e.n++; (e as any)[r.kind]++; byOwner.set(owner, e);
}
const tot = rows.length;
console.log(`first-write faults: ${tot} pages (${(tot * 16 / 1024).toFixed(1)}MB): cell=${rows.filter(r => r.kind === "cell").length} payload=${rows.filter(r => r.kind === "payload").length} other=${rows.filter(r => r.kind === "other").length}`);
for (const [o, e] of [...byOwner].sort((a, b) => b[1].n - a[1].n).slice(0, 45)) console.log(String(e.n).padStart(5), `${(e.n * 16 / 1024).toFixed(1)}MB`.padStart(7), `c${e.cell}/p${e.payload}/o${e.other}`.padEnd(16), o);
if (process.env.EX) for (const [o, e] of [...byOwner].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log("\n#", o, "\n   ", e.ex);
