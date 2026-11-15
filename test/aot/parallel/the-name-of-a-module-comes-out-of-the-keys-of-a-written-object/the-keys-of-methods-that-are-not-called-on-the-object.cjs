// A control: the methods are not called on the object.
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
for (const name of Object.keys(uses)) {
  const use = uses[name];
  console.log(name, use(require(name)));
}
