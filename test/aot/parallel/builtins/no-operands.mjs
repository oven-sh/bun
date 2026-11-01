function tell(f) { try { const r = f(); return r instanceof Promise ? r.then(() => "settled", e => "rejected " + e.name + " " + e.code + ": " + e.message) : "answered " + typeof r; } catch (e) { return "threw " + e.name + " " + e.code + ": " + e.message; } }
console.log(await tell(() => fetch()));
console.log(await tell(() => globalThis.fetch()));
const kept = fetch; console.log(await tell(() => kept()));
console.log(await tell(() => fetch(undefined)));
console.log(await tell(() => fetch.call(null)));
console.log(await tell(() => fetch(...[])));
console.log(await tell(() => new Worker()));
console.log(await tell(() => new Worker(undefined)));
console.log(await tell(() => new globalThis.Worker()));
console.log(await tell(() => Reflect.construct(Worker, [])));
console.log(await tell(() => new Worker(...[])));
