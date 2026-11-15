// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="Late"

// FILE: class-read-declaration-output-hashbang.mjs
#!/usr/bin/env bun
// @bun
// The first line that `bun build --target=bun` writes follows a hashbang, and a class is read above its declaration.
function attempt(read) {
  try {
    console.log(typeof read());
  } catch (error) {
    console.log(error.name);
  }
}
attempt(() => Late);
class Late {}
attempt(() => Late);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
