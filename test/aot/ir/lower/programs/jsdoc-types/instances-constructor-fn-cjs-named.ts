// RUN: lower
// OPTIONS: builtin-modules
// `InstanceType` takes no plain function, so what is written of `thing` says nothing of it.
// CHECK-LABEL: function {{*}}name="show"
// CHECK: b0([[size]]: number, [[thing]]: anything):
// CHECK: = PropGet [[thing]] key="a"

// FILE: main.ts
// The instances of a constructor function of a commonjs module are named in typescript.
type All = typeof import("./library.cjs");

function show(size: All["size"], thing: InstanceType<All["Thing"]>): string {
  return size + " " + thing.a;
}
console.log(show(3, { a: 1 }));

// FILE: library.cjs
function Thing() {
  this.a = 1;
}
module.exports = { Thing, size: 3 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }
