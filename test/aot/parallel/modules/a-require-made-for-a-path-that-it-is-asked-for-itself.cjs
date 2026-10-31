// The build follows `load` to what it is made of, and finds a call of `load` there.
const { createRequire } = require("node:module");
let seen;
try {
  const load = createRequire(load("node:path").join(__dirname, "lib", "index.js"));
  seen = typeof load;
} catch (error) {
  seen = error.name;
}
console.log(seen);
