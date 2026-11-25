// The program walks its own module objects, so the build keeps them all, and code from disk comes to them through require.main. What stands above a file of data in the cache is one of them, and leads no further than they do.
// Flags: --aot-allow-code-from-disk
const kit = require("./kit.cjs");
let total = 0;
for (let i = 0; i < 300; i++) total = kit.sum(total, i) | 0;
console.log(total, module.children.map(child => Object.keys(child.exports).join("+")).join(" "));
for (const line of kit.look()) console.log(line);
