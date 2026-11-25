const uses = {
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
for (const name of Object.keys(uses)) console.log(name, uses[name](require(name)));
