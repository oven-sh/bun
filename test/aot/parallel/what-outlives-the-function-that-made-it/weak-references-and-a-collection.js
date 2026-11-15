const registry = new FinalizationRegistry(() => {});
function make(i) { const o = { v: i }, token = { t: i }; registry.register(o, i, token); return new WeakRef(o); }
const ref = make(1);
function churn() { const junk = []; for (let k = 0; k < 2000; k++) junk.push({ k }, [k]); return junk.length; }
churn(); Bun.gc(true); churn(); Bun.gc(true);
const seen = ref.deref();
console.log(seen === undefined || seen.v === 1);
