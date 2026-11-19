let seen;
const kind = new Proxy(function () {}, { get: (target, key) => (key === Symbol.hasInstance ? value => ((seen = value), true) : target[key]) });
console.log(require instanceof kind, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
