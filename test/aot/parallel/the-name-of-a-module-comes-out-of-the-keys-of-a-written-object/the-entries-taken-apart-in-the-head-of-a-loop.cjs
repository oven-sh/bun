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
for (const [name, use] of Object.entries(uses)) console.log(name, use(require(name)));
