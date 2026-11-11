const uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
walk: for (const name in uses) {
  if (name === "extra") continue walk;
  console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
}
