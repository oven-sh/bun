// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK-LABEL: function {{*}}name="m"

// FILE: main.cjs
// `bun run` evaluates the class statements of a CommonJS file whose evaluation runs no code of the program before the other statements of the file.
function attempt(read) { try { return typeof read(); } catch (error) { return error.name; } }
console.log("early", attempt(() => Plain), attempt(() => WithCall), attempt(() => Exported));
exports.early = attempt(() => Plain);
class Plain { static n = 1; m() { return require("node:path").sep; } }
class WithCall { static n = Math.abs(1); }
module.exports.Exported = class Exported {};
class Exported {}
console.log("late", attempt(() => Plain), attempt(() => WithCall), new Plain().m(), exports.early, this === module.exports);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
