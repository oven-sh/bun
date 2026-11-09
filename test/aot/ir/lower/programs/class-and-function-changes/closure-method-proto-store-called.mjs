// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="use"
// CHECK-LABEL: function {{*}}name="f"

// FILE: main.mjs
// Closure method, proto store, called.
const o = {};
o.__proto__ = ({ f() { return 1; } }.f);
const q = o.__proto__;
function use(v) { return typeof v === "function" ? v() : typeof v; }
console.log(use(q), use(() => 2));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
