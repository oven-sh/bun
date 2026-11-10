// A control: the same, by a plain call.
let seen;
const keep = value => ((seen = value), true);
console.log(keep(require), typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
