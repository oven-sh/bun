// A written type says which members a value has, not which class made it. Each trap runs, in the order of the language.
function row(id) { return { id, name: "r" + id }; }
function text(value) { return JSON.stringify({ value }); }
const seen = [];
const proxy = new Proxy(row(1), {
    get(target, key, receiver) { seen.push("get " + String(key)); return Reflect.get(target, key, receiver); },
    ownKeys(target) { seen.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { seen.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
});
for (const value of [row(0), proxy, row(2)]) console.log(text(value));
console.log(seen.join(", "));
