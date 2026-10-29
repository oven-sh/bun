// The compiler knows the object that require.cache answers by identity, and a validating build looks every such object up when the realm starts
// Flags: --aot-validate
const cache = require.cache;
console.log(typeof cache, cache === require.cache, cache === require("node:module")._cache);
console.log(Object.keys(cache).some(path => path.endsWith("require-cache-in-a-validating-build.cjs")));
