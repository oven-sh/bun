// "node:" + name, a template and concat(): the constant start names no library module, so it brings none in.
// Flags: --aot-refuse-code-from-disk
// Env: NAMES=path,dgram
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import "node:path";

for (const name of process.env.NAMES.split(",")) {
  const ways = {
    plus: () => require("node:" + name),
    template: () => require(`node:${name}`),
    concat: () => require("node:".concat(name)),
    import: () => import("node:" + name),
    "import template": () => import(`node:${name}`),
  };
  for (const way in ways) {
    try {
      console.log(name, way, typeof (await ways[way]()));
    } catch (error) {
      console.log(name, way, error.code);
    }
  }
}
console.log("went on");
/* Output:
path plus object
path template object
path concat object
path import object
path import template object
dgram plus MODULE_NOT_FOUND
dgram template MODULE_NOT_FOUND
dgram concat MODULE_NOT_FOUND
dgram import ERR_MODULE_NOT_FOUND
dgram import template ERR_MODULE_NOT_FOUND
went on
*/
