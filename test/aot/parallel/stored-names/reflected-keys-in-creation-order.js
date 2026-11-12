// The same of keys that Reflect.set creates.
class Client { constructor(given) { this.port = 80; for (const key of Reflect.ownKeys(given)) Reflect.set(this, key, given[key]); this.kind = typeof this.port + typeof this.host; } }
const all = [];
for (let turn = 0; turn < 3; turn++) { all.length = 0; for (const given of [{ port: 443 }, { 0: "zero", port: 2 }, { port: 4, host: "h" }]) all.push(new Client(given)); }
console.log("SAID", all.map(each => Object.keys(each).join()).join(" ; "), JSON.stringify(all));
