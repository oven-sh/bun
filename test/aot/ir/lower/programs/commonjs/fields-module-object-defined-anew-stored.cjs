// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="get"

// FILE: main.cjs
// The fields of a module object are defined anew or stored through another name.
Object.defineProperty(module, "id", { get() { return "from a getter"; } });
Object.defineProperty(module, "loaded", { value: 7 });
console.log(module.id, module.loaded);
const m = module;
m.filename = "through another name";
console.log(module.filename);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
