const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
function* doubled(m: Map<string, number>) { for (const value of m.values()) { const sent: unknown = yield value * 2; if (sent) m.set("sent " + sent, 100); } }
const it = doubled(map); console.log(it.next().value, it.next("x").value, it.next().value, it.next().value, JSON.stringify(it.next()));
async function slowly(m: Map<string, number>) { const seen: string[] = []; for (const [key, value] of m.entries()) { await null; seen.push(key + value); if (key === "a") m.delete("b"); } return seen.join(); }
console.log(await slowly(new Map(map)));
async function together() { const m = new Map([[1, "x"], [2, "y"]]); const walk = async (name: string) => { const seen: string[] = []; for (const key of m.keys()) { seen.push(name + key); await 0; } return seen.join(); }; return (await Promise.all([walk("p"), walk("q")])).join("|"); }
console.log(await together());
function* early(m: Map<string, number>) { try { for (const key of m.keys()) yield key; } finally { console.log("closed"); } }
for (const key of early(map)) { console.log(key); break; }
