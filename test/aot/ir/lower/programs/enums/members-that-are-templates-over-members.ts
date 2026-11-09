// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
import { Constant, Text } from "./texts";

console.log(Text.Both, Text.OfMember, Text.InBrackets, Text.Plain);
console.log(Text.Computed, Text.Negative, Text.Joined);
console.log(Constant.B, Constant.C, JSON.stringify([Constant.A, Constant.B, Text.One, Text.Both]));

enum Local {
  Two = 2,
  Text = `two is ${Two}`,
  Longer = `${Local.Text}, twice ${Two * 2}`,
}
console.log(Local.Text, Local.Longer, Local[2]);

// FILE: texts.ts
export enum Text {
  One = 1,
  Name = "name",
  Both = `a${One}b${Name}c`,
  OfMember = `${Text.Both}!`,
  InBrackets = `<${Text["Name"]}>`,
  Plain = `plain`,
  Computed = `n${1 + 3 - (4 / 2) * 5 ** 2}`,
  Negative = `${-One}|${~One}`,
  Joined = `x${One}` + Name,
}

export const enum Constant {
  A = 123,
  B = `a${A}b`,
  C = `${Constant.B}${Constant["A"]}`,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
