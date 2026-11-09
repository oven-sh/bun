function* g() { for (let i = 0; i < 3; i++) { try { yield i; } catch (e) { yield "c " + (e && e.message) + typeof e; } finally { console.log("f" + i); } } }
async function* relay(it) { yield* it; }
for (const v of [new Error("late"), undefined, 5, "t", null, { message: "m" }]) { const r = relay(g()); await r.next(); console.log(JSON.stringify(await r.throw(v))); }
