// "node:" + name, a template and concat(): the constant start names no library module, so it brings none in.
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
