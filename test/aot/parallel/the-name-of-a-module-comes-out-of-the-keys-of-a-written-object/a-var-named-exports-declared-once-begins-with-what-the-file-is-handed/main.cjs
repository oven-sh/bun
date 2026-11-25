module.exports.extra = found => found.name;
if (process.argv.length > 99) {
  var exports = {
    one(found) {
      return found.name;
    },
  };
}
for (const name in exports) console.log("SAID", name, exports[name](require(`./${name}.cjs`)));
