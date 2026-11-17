const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
uses.valueOf``.extra = found => found.name;
for (const name of Object.keys(uses)) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
