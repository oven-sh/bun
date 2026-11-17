var uses;
function go() {
  for (const name of Object.keys(uses)) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
}
uses = {
  __defineGetter__(found) {
    return found.name;
  },
};
go();
uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
uses.__defineGetter__("extra", () => found => found.name);
go();
