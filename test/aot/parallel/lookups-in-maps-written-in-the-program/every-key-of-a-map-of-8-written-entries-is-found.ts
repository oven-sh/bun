const m = new Map([["key0", 1], ["key1", 4], ["key2", 7], ["key3", 10], ["key4", 13], ["key5", 16], ["key6", 19], ["key7", 22]]), t = new Map([["key0", "v0"], ["key1", "v1"], ["key2", "v2"], ["key3", "v3"], ["key4", "v4"], ["key5", "v5"], ["key6", "v6"], ["key7", "v7"]]), ks = ["key0", "key1", "key2", "key3", "key4", "key5", "key6", "key7"];
let s = 0, bad = 0;
for (let r = 0; r < 2; r++) for (let i = 0; i < ks.length; i++) { const v = m.get(ks[i]!)!; s += v; if (v !== 3 * i + 1) bad++; if (t.get(ks[i]!) !== "v" + i) bad += 1000; }
console.log(s, bad, m.get("key" + ks.length), t.get("nothing"));
