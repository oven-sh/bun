const inputs = ["x = a ? (b) : c => (d) : e;", "x = a ? (b): c => ((d), (e)) : (f);", "x = a ? (b: T): U => (c) : (d);", "x = a ? (b) : c => d : e;", "x = a ? (b): c => d : eee;", "x = a ? (b): ccc => d : e ? (f) : g => h : i;"];
const t = new Bun.Transpiler({ loader: "ts" });
for (const src of inputs) { let out; try { out = "OK  " + t.transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { out = "ERR " + (e.errors?.[0]?.message ?? e.message); } console.log(JSON.stringify(src).padEnd(52), out); }
