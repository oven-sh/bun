let settings: unknown;
try {
  settings = load();
} catch (error) { // @ts-expect-error
  console.log("caught", error.name);
}
console.log(typeof settings);
function load() {
  return require("./wrapped.ts");
}
