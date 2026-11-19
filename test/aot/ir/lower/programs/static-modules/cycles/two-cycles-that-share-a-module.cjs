// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// One module lies on two cycles: it requires left and right, and both require it back, at two stages of its body.
const hub = require("./hub.cjs");
console.log(hub.left.now(), hub.right.now());

// FILE: hub.cjs
console.log("hub starts");
exports.stage = 1;
exports.left = require("./left.cjs");
exports.stage = 2;
exports.right = require("./right.cjs");
exports.stage = 3;
console.log("hub ends");

// FILE: left.cjs
const hub = require("./hub.cjs");
console.log("left sees hub", hub.stage);
exports.now = () => hub.stage;

// FILE: right.cjs
const hub = require("./hub.cjs");
console.log("right sees hub", hub.stage);
exports.now = () => hub.stage;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
