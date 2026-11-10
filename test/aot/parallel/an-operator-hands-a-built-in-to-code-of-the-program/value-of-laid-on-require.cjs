let seen;
require.valueOf = function () {
  seen = this;
  return 1;
};
console.log(require + 1, typeof seen(process.env.NAME ?? "node:zlib").gzipSync);
