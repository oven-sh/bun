// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// Requires in optional chains that stop.
const no = globalThis.nothingHere;
no?.x(require("./x.cjs"));
no?.x.y.z(require("./x.cjs"));
no?.x[require("./x.cjs")];
no?.x.y(1)[2](require("./x.cjs").v);
console.log("none ran");
console.log(require("./y.cjs").seen);

// FILE: x.cjs
console.log("x runs"); globalThis.xRan = true; exports.v = 1;

// FILE: y.cjs
exports.seen = String(globalThis.xRan);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
