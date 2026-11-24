let later;
const far = [
  {
    one(found) {
      return found.name;
    },
    two(found) {
      return found.name;
    },
  },
].find(uses => {
  later = () => {
    for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
  };
  return true;
});
far.extra = found => found.name;
later();
