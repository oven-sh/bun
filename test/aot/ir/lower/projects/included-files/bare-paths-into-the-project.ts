// RUN: lower

// FILE: src/main.ts
console.log(typeof fromReal);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[],"paths":{"src/*":["./src/*"]},"allowImportingTsExtensions":true,"noEmit":true},"include":["src","tests"]}

// FILE: node_modules/real/package.json
{"name":"real","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/real/index.js
exports.value = 1;

// FILE: node_modules/real/index.d.ts
export declare const value: number;
declare global {
  var fromReal: number | undefined;
}

// FILE: src/parts/part0.ts
export const part0 = 0;

// FILE: tests/deep/er/test0.ts
import { part0 } from "src/parts/part0.ts";
import { value } from "real";
export const seen = [part0, value];

// FILE: src/parts/part1.ts
export const part1 = 1;

// FILE: tests/deep/er/test1.ts
import { part1 } from "src/parts/part1.ts";
import { value } from "real";
export const seen = [part1, value];

// FILE: src/parts/part2.ts
export const part2 = 2;

// FILE: tests/deep/er/test2.ts
import { part2 } from "src/parts/part2.ts";
import { value } from "real";
export const seen = [part2, value];

// FILE: src/parts/part3.ts
export const part3 = 3;

// FILE: tests/deep/er/test3.ts
import { part3 } from "src/parts/part3.ts";
import { value } from "real";
export const seen = [part3, value];

// FILE: src/parts/part4.ts
export const part4 = 4;

// FILE: tests/deep/er/test4.ts
import { part4 } from "src/parts/part4.ts";
import { value } from "real";
export const seen = [part4, value];

// FILE: src/parts/part5.ts
export const part5 = 5;

// FILE: tests/deep/er/test5.ts
import { part5 } from "src/parts/part5.ts";
import { value } from "real";
export const seen = [part5, value];

// FILE: src/parts/part6.ts
export const part6 = 6;

// FILE: tests/deep/er/test6.ts
import { part6 } from "src/parts/part6.ts";
import { value } from "real";
export const seen = [part6, value];

// FILE: src/parts/part7.ts
export const part7 = 7;

// FILE: tests/deep/er/test7.ts
import { part7 } from "src/parts/part7.ts";
import { value } from "real";
export const seen = [part7, value];

// FILE: src/parts/part8.ts
export const part8 = 8;

// FILE: tests/deep/er/test8.ts
import { part8 } from "src/parts/part8.ts";
import { value } from "real";
export const seen = [part8, value];

// FILE: src/parts/part9.ts
export const part9 = 9;

// FILE: tests/deep/er/test9.ts
import { part9 } from "src/parts/part9.ts";
import { value } from "real";
export const seen = [part9, value];

// FILE: src/parts/part10.ts
export const part10 = 10;

// FILE: tests/deep/er/test10.ts
import { part10 } from "src/parts/part10.ts";
import { value } from "real";
export const seen = [part10, value];

// FILE: src/parts/part11.ts
export const part11 = 11;

// FILE: tests/deep/er/test11.ts
import { part11 } from "src/parts/part11.ts";
import { value } from "real";
export const seen = [part11, value];

// FILE: src/parts/part12.ts
export const part12 = 12;

// FILE: tests/deep/er/test12.ts
import { part12 } from "src/parts/part12.ts";
import { value } from "real";
export const seen = [part12, value];

// FILE: src/parts/part13.ts
export const part13 = 13;

// FILE: tests/deep/er/test13.ts
import { part13 } from "src/parts/part13.ts";
import { value } from "real";
export const seen = [part13, value];

// FILE: src/parts/part14.ts
export const part14 = 14;

// FILE: tests/deep/er/test14.ts
import { part14 } from "src/parts/part14.ts";
import { value } from "real";
export const seen = [part14, value];

// FILE: src/parts/part15.ts
export const part15 = 15;

// FILE: tests/deep/er/test15.ts
import { part15 } from "src/parts/part15.ts";
import { value } from "real";
export const seen = [part15, value];

// FILE: src/parts/part16.ts
export const part16 = 16;

// FILE: tests/deep/er/test16.ts
import { part16 } from "src/parts/part16.ts";
import { value } from "real";
export const seen = [part16, value];

// FILE: src/parts/part17.ts
export const part17 = 17;

// FILE: tests/deep/er/test17.ts
import { part17 } from "src/parts/part17.ts";
import { value } from "real";
export const seen = [part17, value];

// FILE: src/parts/part18.ts
export const part18 = 18;

// FILE: tests/deep/er/test18.ts
import { part18 } from "src/parts/part18.ts";
import { value } from "real";
export const seen = [part18, value];

// FILE: src/parts/part19.ts
export const part19 = 19;

// FILE: tests/deep/er/test19.ts
import { part19 } from "src/parts/part19.ts";
import { value } from "real";
export const seen = [part19, value];

// FILE: src/parts/part20.ts
export const part20 = 20;

// FILE: tests/deep/er/test20.ts
import { part20 } from "src/parts/part20.ts";
import { value } from "real";
export const seen = [part20, value];

// FILE: src/parts/part21.ts
export const part21 = 21;

// FILE: tests/deep/er/test21.ts
import { part21 } from "src/parts/part21.ts";
import { value } from "real";
export const seen = [part21, value];

// FILE: src/parts/part22.ts
export const part22 = 22;

// FILE: tests/deep/er/test22.ts
import { part22 } from "src/parts/part22.ts";
import { value } from "real";
export const seen = [part22, value];

// FILE: src/parts/part23.ts
export const part23 = 23;

// FILE: tests/deep/er/test23.ts
import { part23 } from "src/parts/part23.ts";
import { value } from "real";
export const seen = [part23, value];

// FILE: src/parts/part24.ts
export const part24 = 24;

// FILE: tests/deep/er/test24.ts
import { part24 } from "src/parts/part24.ts";
import { value } from "real";
export const seen = [part24, value];

// FILE: src/parts/part25.ts
export const part25 = 25;

// FILE: tests/deep/er/test25.ts
import { part25 } from "src/parts/part25.ts";
import { value } from "real";
export const seen = [part25, value];

// FILE: src/parts/part26.ts
export const part26 = 26;

// FILE: tests/deep/er/test26.ts
import { part26 } from "src/parts/part26.ts";
import { value } from "real";
export const seen = [part26, value];

// FILE: src/parts/part27.ts
export const part27 = 27;

// FILE: tests/deep/er/test27.ts
import { part27 } from "src/parts/part27.ts";
import { value } from "real";
export const seen = [part27, value];

// FILE: src/parts/part28.ts
export const part28 = 28;

// FILE: tests/deep/er/test28.ts
import { part28 } from "src/parts/part28.ts";
import { value } from "real";
export const seen = [part28, value];

// FILE: src/parts/part29.ts
export const part29 = 29;

// FILE: tests/deep/er/test29.ts
import { part29 } from "src/parts/part29.ts";
import { value } from "real";
export const seen = [part29, value];

// FILE: src/parts/part30.ts
export const part30 = 30;

// FILE: tests/deep/er/test30.ts
import { part30 } from "src/parts/part30.ts";
import { value } from "real";
export const seen = [part30, value];

// FILE: src/parts/part31.ts
export const part31 = 31;

// FILE: tests/deep/er/test31.ts
import { part31 } from "src/parts/part31.ts";
import { value } from "real";
export const seen = [part31, value];

// FILE: src/parts/part32.ts
export const part32 = 32;

// FILE: tests/deep/er/test32.ts
import { part32 } from "src/parts/part32.ts";
import { value } from "real";
export const seen = [part32, value];

// FILE: src/parts/part33.ts
export const part33 = 33;

// FILE: tests/deep/er/test33.ts
import { part33 } from "src/parts/part33.ts";
import { value } from "real";
export const seen = [part33, value];

// FILE: src/parts/part34.ts
export const part34 = 34;

// FILE: tests/deep/er/test34.ts
import { part34 } from "src/parts/part34.ts";
import { value } from "real";
export const seen = [part34, value];

// FILE: src/parts/part35.ts
export const part35 = 35;

// FILE: tests/deep/er/test35.ts
import { part35 } from "src/parts/part35.ts";
import { value } from "real";
export const seen = [part35, value];

// FILE: src/parts/part36.ts
export const part36 = 36;

// FILE: tests/deep/er/test36.ts
import { part36 } from "src/parts/part36.ts";
import { value } from "real";
export const seen = [part36, value];

// FILE: src/parts/part37.ts
export const part37 = 37;

// FILE: tests/deep/er/test37.ts
import { part37 } from "src/parts/part37.ts";
import { value } from "real";
export const seen = [part37, value];

// FILE: src/parts/part38.ts
export const part38 = 38;

// FILE: tests/deep/er/test38.ts
import { part38 } from "src/parts/part38.ts";
import { value } from "real";
export const seen = [part38, value];

// FILE: src/parts/part39.ts
export const part39 = 39;

// FILE: tests/deep/er/test39.ts
import { part39 } from "src/parts/part39.ts";
import { value } from "real";
export const seen = [part39, value];
