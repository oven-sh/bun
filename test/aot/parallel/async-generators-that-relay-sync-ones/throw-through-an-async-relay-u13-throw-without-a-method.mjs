async function* relay(it) { yield* it; }
const own = { [Symbol.iterator]() { return this; }, next() { return { value: 1, done: false }; }, return(v) { console.log("return"); return { value: v, done: true }; } };
const r = relay(own); await r.next(); try { await r.throw(new Error("late")); } catch (e) { console.log(e.name); }
