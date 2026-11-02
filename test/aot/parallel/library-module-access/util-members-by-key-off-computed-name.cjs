// node:util is required under a name put together at run time, and its members are read under keys out of a list.
const computedName = ["node:", "util"].join("");
const m = require(computedName);
for (const key of ["inherits", "formatWithOptions", "format", "inspect", "stripVTControlCharacters"]) {
  try {
    console.log(key, typeof m[key]);
  } catch (e) {
    console.log(key, String(e).slice(0, 90));
  }
}
try {
  console.log(m["formatWithOptions"]({}, "%s-%d", "a", 1));
} catch (e) {
  console.log(String(e).slice(0, 90));
}
