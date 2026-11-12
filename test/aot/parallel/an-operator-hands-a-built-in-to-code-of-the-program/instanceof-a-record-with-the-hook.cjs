let seen;
const kind = {
  [Symbol.hasInstance](value) {
    seen = value;
    return true;
  },
};
console.log(require instanceof kind, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
