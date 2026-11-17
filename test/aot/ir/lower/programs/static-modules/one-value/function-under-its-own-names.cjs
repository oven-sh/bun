// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `module.exports = fastify; module.exports.fastify = fastify; module.exports.default = fastify`: the function is its own member, twice, for importers of every kind. One member is stored through the function's own name, ahead of the export.
const fastify = require("./fastify.cjs");
const { fastify: named, default: byDefault } = require("./fastify.cjs");
console.log(fastify === named, named === byDefault, fastify.fastify.default.fastify === fastify, fastify({ a: 1 }).version, Object.keys(fastify).join());

// FILE: fastify.cjs
"use strict";
function fastify(options) {
  return { options, version: fastify.version };
}
fastify.version = "5";
module.exports = fastify;
module.exports.fastify = fastify;
module.exports.default = fastify;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
