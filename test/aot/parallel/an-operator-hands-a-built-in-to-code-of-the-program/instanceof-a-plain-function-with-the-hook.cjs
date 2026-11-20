let seen;
function Kind() {}
Object.defineProperty(Kind, Symbol.hasInstance, { value: value => ((seen = value), true) });
console.log(require instanceof Kind, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
