let settings: unknown;
try {
  settings = load();
} catch (error) {
  console.log("caught", error.name, error.message);
}
console.log(typeof settings);
function load() {
  return require("./wrapped.ts");
}
