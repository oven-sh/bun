let seen;
class Box {}
Object.defineProperty(Box, Symbol.hasInstance, {
  value(value) {
    seen = value;
    return true;
  },
});
console.log(require instanceof Box, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
