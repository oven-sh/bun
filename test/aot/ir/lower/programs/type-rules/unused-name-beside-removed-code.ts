// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: Integer integer=1
// CHECK-LABEL: function {{*}}name="isAbsolute"

// FILE: main.ts
// A name that nothing reads stops no build, whatever `noUnusedLocals` says, and nothing is built for it.
const WINDOWS_PATH = /^[a-zA-Z]:/;
const neverRead = 1;
function isAbsolute(path: string): boolean {
  if (process.platform === "win32") return WINDOWS_PATH.test(path);
  return path.startsWith("/");
}
console.log(isAbsolute("/a"));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "noUnusedLocals": true, "noUnusedParameters": true }, "files": [] }
