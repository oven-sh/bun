const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
try {
  new uses.one({ name: "made" });
} catch (error) {
  console.log("SAID", error.constructor.name);
}
for (const name of Object.keys(uses)) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
