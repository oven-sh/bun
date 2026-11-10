const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
console.log("SAID", Math.max(...Object.values(uses).map(use => use.length)));
for (const name of Object.keys(uses)) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
