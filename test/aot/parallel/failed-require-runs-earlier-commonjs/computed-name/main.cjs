// A graph that fails to load behind a require() of a computed name: the CommonJS files before the failure run, as behind a constant name.
const show = load => {
  try {
    load();
    console.log("loaded");
  } catch (error) {
    console.log("caught", error.constructor.name);
  }
};
const loadByName = name => require(name);
const missing = process.argv.length > 99 ? "./fine.mjs" : "./missing.mjs";
const unlinked = ["unlinked", "fine"][process.argv.length > 99 ? 1 : 0];

show(() => require(missing));
show(() => require("./" + unlinked + ".mjs"));
show(() => loadByName("./deep.mjs"));
show(() => loadByName("./fine.mjs"));
show(() => loadByName("./deep.mjs"));
console.log("end");
