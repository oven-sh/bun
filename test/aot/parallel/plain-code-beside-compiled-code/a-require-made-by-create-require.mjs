import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
console.log(typeof made, typeof made.resolve, made("node:path").basename("/a/b.txt"));
for (const bad of ["not a path", 7, undefined]) {
  try {
    console.log(typeof createRequire(bad));
  } catch (error) {
    console.log(error.code ?? error.name);
  }
}
/* Output:
function function b.txt
ERR_INVALID_ARG_VALUE
ERR_INVALID_ARG_VALUE
ERR_INVALID_ARG_VALUE
*/
