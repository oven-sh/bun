// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// The function that `forEach` calls stores to the list through its third parameter. `import()` gets the names.
const names = ["A", "B"];
names.forEach((name, index, list) => {
  list[index] = name.toLowerCase();
});
for (const name of names) console.log((await import("./lib/" + name + ".ts")).who);

// FILE: lib/a.ts
export const who: string = "lib/a";

// FILE: lib/b.ts
export const who: string = "lib/b";

// FILE: lib/c.ts
export const who: string = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
