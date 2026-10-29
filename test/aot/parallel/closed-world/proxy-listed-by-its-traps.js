// A proxy is spread, copied, enumerated and listed by built-ins. Each of them asks the handler for the keys, for the property under each key and for its value, and does nothing else
// to the proxy: what the traps are handed stays known, and nothing of the library is compiled for it.
// STATISTIC: ImageFunctionsEmitted <= 30
const names = ["first", "second"];
const asked = [];
const proxy = new Proxy({ FIRST: 1, SECOND: 2 }, {
  ownKeys() { asked.push("keys"); return names.slice(); },
  getOwnPropertyDescriptor(target, key) { asked.push("describe " + key); return Reflect.getOwnPropertyDescriptor(target, key.toUpperCase()); },
  get(target, key) { asked.push("get " + key); return target[key.toUpperCase()]; },
});
const tell = label => { console.log(label, asked.join(", ")); asked.length = 0; };

const spread = { zero: 0, ...proxy, third: 3 };
console.log(spread.zero, spread.first, spread.second, spread.third);
tell("spread:");
const { first, ...others } = proxy;
console.log(first, others.first, others.second);
tell("rest:");
console.log(Object.keys(proxy).join());
tell("keys:");
console.log(Object.values(proxy).join());
tell("values:");
for (const [key, value] of Object.entries(proxy)) console.log(key, value);
tell("entries:");
const assigned = Object.assign({ set second(value) { console.log("stored", value); } }, proxy);
console.log(assigned.first, assigned.second);
tell("assign:");
for (const key in proxy) console.log(key);
tell("for-in:");
console.log(Reflect.ownKeys(proxy).join(), Object.getOwnPropertyNames(proxy).join());
tell("names:");
console.log(proxy.first);
tell("read:");
