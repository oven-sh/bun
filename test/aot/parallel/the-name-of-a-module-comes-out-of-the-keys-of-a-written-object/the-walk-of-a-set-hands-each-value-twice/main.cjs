new Set([
  {
    one(found) {
      return found.name;
    },
    two(found) {
      return found.name;
    },
  },
]).forEach((uses, far) => {
  far.extra = found => found.name;
  for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
});
