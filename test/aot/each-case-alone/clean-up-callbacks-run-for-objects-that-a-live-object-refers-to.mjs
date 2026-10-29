// The clean-up callback of a registry must not run for an object that a live object refers to, also when no code reads the reference. An executable has no property that nothing reads, so no case here holds its object by one.
async function collect() { for (let i = 0; i < 4; i++) { await new Promise(done => setTimeout(done, 1)); Bun.gc(true); } }
async function t(name, make) { let cleaned = 0; const registry = new FinalizationRegistry(() => cleaned++); const holders = []; for (let i = 0; i < 500; i++) holders.push(make(i, o => (registry.register(o, i), o))); await collect(); await collect(); console.log(name, cleaned, holders.length); }
await t("private field", (i, watch) => { class Holder { #keep; constructor(o) { this.#keep = o; } } return new Holder(watch({ i })); });
await t("list", (i, watch) => { const l = []; l.push(watch({ i })); return l; });
