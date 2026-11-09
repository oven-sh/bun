// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="Late"

// FILE: class-read-declaration-bundle-cjs-format.cjs
// @bun @bun-cjs
// A class is read above its declaration in a bundle in the commonjs format of bun build.
(function(exports, require, module, __filename, __dirname) {// A class whose body calls nothing is read above its declaration.
function attempt(read) {
  try {
    console.log(typeof read());
  } catch (error) {
    console.log(error.name);
  }
}
attempt(() => Late);
class Late {
  static first = 1;
}
attempt(() => Late);
})

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
