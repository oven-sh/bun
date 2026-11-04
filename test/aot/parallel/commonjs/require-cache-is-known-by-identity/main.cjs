// The compiler knows the object that require.cache answers by identity.
const cache = require.cache;
console.log(typeof cache, cache === require.cache, cache === require("node:module")._cache);
console.log(Object.keys(cache).some(path => path.endsWith("require-cache-is-known-by-identity.cjs")));
