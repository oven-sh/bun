// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// The es module marker is set last or in a branch.
import d, { x } from "./m.cjs";
import e from "./n.cjs";
console.log(JSON.stringify(d), x, JSON.stringify(e));

// FILE: m.cjs
exports.x = 1;
exports.default = "the default";
Object.defineProperty(exports, "__esModule", { value: true });

// FILE: n.cjs
exports.default = "n default";
if (Date.now() > 0) exports.__esModule = true;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
