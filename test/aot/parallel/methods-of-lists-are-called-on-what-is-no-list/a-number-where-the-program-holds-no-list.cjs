const path = require("node:path");
function make(n) {
  return n % 3 === 1 ? { name: n, kind: "r" } : n % 5 === 2 ? n : path.parse("/a/b.c");
}
function mapped(n) {
  const v = make(n);
  try {
    console.log(v.name.map(y => 1).length);
  } catch (error) {
    console.log(error.constructor.name, error.message);
  }
}
for (let n = 0; n < 6; n++) mapped(n);
