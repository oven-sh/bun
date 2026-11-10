// The body throws at its first run, leaves the cache and runs again: each run has constants of its own.
function load() {
  try {
    return require("./dep.cjs");
  } catch (error) {
    return error.message;
  }
}
console.log(load());
console.log(load().kind());
