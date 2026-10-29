// The options of three native functions are copied under keys that are made at run time. A read under such a key may find what every object inherits. Each function reads its options under their names and takes every object for them: no message describes the options, so nothing that prints a value is compiled.
// STATISTIC: ImageFunctionsEmitted <= 30
const store = { LEVEL: 1, PATH: "/nowhere", ALGORITHM: "bcrypt", COST: 4 };
function copyOf(text) {
  const copy = {};
  for (const name of JSON.parse(text)) copy[name] = store[name.toUpperCase()];
  return copy;
}
console.log(Bun.gzipSync("x", copyOf('["level"]')).length > 0);
console.log(Bun.which("no-such-program", copyOf('["PATH"]')));
console.log(Bun.password.hashSync("x", copyOf('["algorithm", "cost"]')).length > 0);
