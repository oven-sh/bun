// A file takes the function that loads other files off its module under a key that it finds while it runs. A text of the file is the name, so the name is spelled.
const key = [String(Date.now()), "require"].sort().pop();
const tell = (what, f) => {
  let told;
  try {
    told = f();
  } catch (error) {
    told = "threw " + error.constructor.name;
  }
  console.log(what, told);
};
require("./other.cjs");
tell("where a module is", () => typeof (module || {})[key].call(module, "os").EOL);
tell("by Reflect", () => typeof Reflect.apply(module[key], module, ["os"]).EOL);
tell("called in place", () => typeof module[key]("os").EOL);
tell("asked twice", () => typeof module?.[key]?.("os").EOL);
tell("kept first", () => {
  const load = module[key];
  return typeof load.call(module, "node:url").fileURLToPath;
});
tell("one function", () => module[key] === module.require);
tell("keys beside it", () => [typeof module[["ex", "ports"].join("")], module[String(Date.now()).replace(/\d+/, "id")] === module.id].join());
tell("a file that a require() names too", () => module[key]("./other.cjs").other);
tell("its type", () => typeof module[key]);
tell("whether it is there", () => key in module);
function inner(module) {
  return module[key];
}
tell("a parameter of that name", () => inner({ require: "mine" }));
