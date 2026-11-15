const { table: uses, table: far } = {
  table: {
    one(found) {
      return found.name;
    },
    two(found) {
      return found.name;
    },
  },
};
far.extra = found => found.name;
for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
