function load(
  uses = {
    extra(found) {
      return found.name;
    },
  },
) {
  if (process.argv.length > 99) {
    var uses = {
      one(found) {
        return found.name;
      },
    };
  }
  for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
}
load();
