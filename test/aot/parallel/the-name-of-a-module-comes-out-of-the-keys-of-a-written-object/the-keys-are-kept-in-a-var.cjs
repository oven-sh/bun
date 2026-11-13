var uses = {
  zlib(found) {
    return typeof found.gzipSync;
  },
  querystring(found) {
    return found.stringify({ a: 1 });
  },
  os(found) {
    return typeof found.EOL;
  },
};
var names = Object.keys(uses);
for (const name of names) console.log(name, uses[name](require(name)));
