module.exports.extra = found => found.name;
if (process.argv.length > 99) {
  var exports = {
    one(found) {
      return found.name;
    },
  };
} else if (process.argv.length > 98) {
  var exports = {
    two(found) {
      return found.name;
    },
  };
}
for (const name in exports) console.log("SAID", name, exports[name](require(`./${name}.cjs`)));
