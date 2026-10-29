// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2339 1
// DIAGNOSTIC: TS2345 1

// FILE: main.ts
/// <reference path="./globals.d.ts" />
// Under `bun run` the class and the enum of this file are variables of the file, and no global `Level` has the members that the declaration file lists.
class Held {
  own = 1;
}
enum Level {
  Own = 4,
}
function show(level: Level): string {
  return level + " " + Level[level];
}
console.log(new Held().own, new Held().declared, show(Level.Own), show(3));

// FILE: globals.d.ts
interface Held {
  declared?: number;
}
declare enum Level {
  One = 1,
  Three = 3,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts" ] }
