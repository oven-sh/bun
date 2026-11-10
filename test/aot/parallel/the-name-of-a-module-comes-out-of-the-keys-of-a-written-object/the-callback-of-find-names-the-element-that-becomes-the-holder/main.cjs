const uses = [
  {
    one(found) {
      return found.name;
    },
    two(found) {
      return found.name;
    },
  },
].find(table => {
  table.extra = found => found.name;
  return true;
});
for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
