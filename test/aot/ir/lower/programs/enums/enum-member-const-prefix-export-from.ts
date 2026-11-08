// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="row"
// CHECK-LABEL: function {{*}}name="reads"

// FILE: main.ts
// Plain Bun ends the prefix of inlined `const`s of a file where it parses `export { .. } from`, so a `const` above every other statement of such a file is a variable. The prefix of a function in the file is not affected.
const leading = 5;
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

function reads() {
  const inner = 3;
  {
    enum E { Leading = leading, AfterLeading, Inner = inner, AfterInner }
    return E;
  }
}
row("a file that exports from another", reads());
export { shared } from "./shared";

// FILE: shared.ts
export const shared = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
