if (process.argv.length > 99) {
  var uses = {
    one(found) {
      return found.name;
    },
  };
}
// prettier-ignore
for (var uses = { extra(found) { return found.name; } } in {});
for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
