// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: Build 1
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// Odd keys of a json file are imported by name.
import {
  a,
  constructor,
  toString,
  é,
  日本,
  big,
  minus,
  long,
  text,
  then,
  length,
  "with space" as spaced,
  "0" as zero,
  "" as empty,
} from "./data.json";
console.log(
  a,
  constructor,
  toString,
  é,
  日本,
  big,
  Object.is(minus, -0),
  long,
  text.length,
  text,
  then,
  length,
  spaced,
  zero,
  empty,
);

// FILE: data.json
{
  "a": 1,
  "a": 2,
  "0": "zero",
  "1.5": "frac",
  "__proto__": { "polluted": true },
  "constructor": "c",
  "toString": "t",
  "with space": 3,
  "é": "accent",
  "日本": "kanji",
  "": "empty",
  "big": 1e400,
  "minus": -0,
  "long": 12345678901234567890,
  "text": "é日本😀\u0000",
  "default": "d",
  "then": "t",
  "length": 7
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
