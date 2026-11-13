const cache = { a: 1, b: 2 };
async function get(key) { return cache[key]; }
const flags = {};
Object.defineProperty(flags, "ready", { get: async () => cache.a + cache.b });
const holder = { async read(key) { return cache[key]; } };
function tell(road, answer) { console.log(road, answer instanceof Promise ? "a promise" : "NO PROMISE: " + String(answer)); }
function deed(key) { tell("by name", get(key)); tell("call", get.call(null, key)); tell("apply", get.apply(null, [key])); tell("getter", flags.ready); tell("method", holder.read(key)); tell("method through call", holder.read.call(holder, key)); }
for (let i = 0; i < 3; i++) { deed(i & 1 ? "a" : "b"); console.log(await get.call(null, "a"), await get.apply(null, ["b"]), await flags.ready, await holder.read.call(holder, "a")); }
