import { base } from "./dep.mjs";
export class G { static made = []; static async later(n) { G.made.push(n); await null; G.made.push(n + base); return G.made.length; } *each(n) { for (let i = 0; i < n; i++) yield G.made.length + i; } async *slow(n) { for (let i = 0; i < n; i++) { await null; yield G.made.length * i; } } }
{ const shared = []; G.note = async n => { shared.push(n); await null; return shared.join("+"); }; }
export async function use() { const out = [await G.later(1), [...new G().each(3)].join(","), await G.note(1), await G.note(2)]; for await (const v of new G().slow(3)) out.push(v); return out.join(" "); }
