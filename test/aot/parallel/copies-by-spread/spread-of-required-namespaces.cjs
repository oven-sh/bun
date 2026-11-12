let tried; try { tried = require("./part-exports.mjs"); } catch (error) {}
({ ...tried });
console.log(Object.keys({ ...tried }).join());
console.log(Object.keys({ before: 0, ...tried, after: 9 }).join());
const conditional = process.argv.length < 90 ? require("./part-exports.mjs") : undefined;
for (const name in { ...conditional }) console.log(name);
function load() { try { return require("./part-exports.mjs"); } catch (error) { return undefined; } }
console.log(JSON.stringify({ ...load() }), Object.entries({ ...load() }).length);
let empty; try { empty = require("./part-exports.mjs"); } catch (error) { empty = {}; }
const copy = { ...empty };
console.log(Object.keys(copy).join(), Object.isExtensible(copy));
module.exports = { ...tried };
console.log(Object.keys(module.exports).join());
