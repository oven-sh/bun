// require() of an ES module that imports a CommonJS file goes through what the module links to once: where it takes the names of the library's modules. The link goes by the same walk.
// COUNT: sought:LinksBelowRoots <= 4
globalThis.ran = [];
const load = [() => require("./a.mjs"), () => require("./b.mjs"), () => require("./c.mjs")];
console.log(load.map(one => one().name).join(" "), globalThis.ran.join(" "));
