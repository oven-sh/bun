// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// Object assign and define property store to an enum.
import { Color } from "./color";
import { read } from "./reader";
console.log(read(), Object.keys(Color).join());
Object.assign(Color, { Green: 9 });
console.log(read());
Object.defineProperty(Color, "Red", { value: 8 });
console.log(read());

// FILE: color.ts
export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}

// FILE: reader.ts
import { Color } from "./color";
export function read() {
  return [Color.Red, Color.Green, Color.Blue, Color["Green"]].join();
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
