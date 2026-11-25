[
  {
    one(found) {
      return found.name;
    },
    two(found) {
      return found.name;
    },
  },
].forEach((far, index, all) => {
  far.extra = found => found.name;
  const uses = all[0];
  for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
});
