// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.mjs
// Two modules wait for a module that awaits. The first of them to go on requires a module that imports the second, which has not gone on yet, so require() throws. The required module runs as soon as the second has, and a later import() of it settles. Plain Bun prints another output.
Promise.all([import("./requires.mjs"), import("./waits.mjs")]).then(() => {
  console.log("both are imported");
  import("./required.mjs").then(names => console.log("required is imported:", Object.keys(names).join()));
});

// FILE: awaits.mjs
console.log("awaits begins");
await 0;
console.log("awaits goes on");

// FILE: required.mjs
import "./waits.mjs";
console.log("required runs");
export const value = 1;

// FILE: requires.mjs
import "./awaits.mjs";
console.log("requires goes on");
try {
  console.log(Object.keys(require("./required.mjs")).join());
} catch (error) {
  console.log("require() throws a", error.name);
}

// FILE: waits.mjs
import "./awaits.mjs";
console.log("waits goes on");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
