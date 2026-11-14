let seen;
class Box {
  static [Symbol.hasInstance](value) {
    seen = value;
    return true;
  }
}
console.log(module instanceof Box, typeof seen.require(process.env.NAME ?? "node:zlib").gzipSync);
