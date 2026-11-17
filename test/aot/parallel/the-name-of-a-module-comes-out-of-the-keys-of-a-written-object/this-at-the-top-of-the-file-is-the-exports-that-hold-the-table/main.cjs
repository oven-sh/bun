const uses = (exports.table = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
});
this.table.extra = found => found.name;
for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
