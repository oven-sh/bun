// #941 - esbuild does not play nicely with the ESM-style import-export 
//  with assert's function-type export. CommonJS-style fixes it.
module.exports = require('assert');
