const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
with (uses) {
  one = found => found.name + " through with";
}
for (const name of Object.keys(uses)) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
