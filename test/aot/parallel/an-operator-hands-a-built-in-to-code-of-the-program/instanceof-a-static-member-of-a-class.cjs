let seen;
class Box {
  static [Symbol.hasInstance](value) {
    seen = value;
    return true;
  }
}
console.log(require instanceof Box, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
