[
  {
    one(found) {
      eval("this.extra = found => found.name");
      return found.name;
    },
    two(found) {
      return found.name;
    },
  },
].forEach(uses => {
  uses.one({ name: "first" });
  for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
});
