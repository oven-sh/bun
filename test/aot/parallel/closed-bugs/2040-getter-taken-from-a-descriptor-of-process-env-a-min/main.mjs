const d = Object.getOwnPropertyDescriptor(process.env, "TZ");
const kept = { get: d.get };
console.log(typeof kept.get);
