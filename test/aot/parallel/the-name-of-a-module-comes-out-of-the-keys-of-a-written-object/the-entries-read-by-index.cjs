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
for (const pair of Object.entries(uses)) console.log(pair[0], pair[1](require(pair[0])));
