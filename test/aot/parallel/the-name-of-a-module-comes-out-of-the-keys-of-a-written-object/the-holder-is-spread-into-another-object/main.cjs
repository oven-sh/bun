const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
const copy = { ...uses };
copy.extra = found => found.name;
console.log("SAID", Object.keys(copy).length);
for (const name of Object.keys(uses)) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
