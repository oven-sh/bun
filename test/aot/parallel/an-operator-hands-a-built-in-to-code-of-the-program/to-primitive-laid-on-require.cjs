let seen;
require[Symbol.toPrimitive] = function () {
  seen = this;
  return "text";
};
console.log(`${require}`, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
