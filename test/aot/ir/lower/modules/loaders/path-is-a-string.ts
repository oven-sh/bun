// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:2

// FILE: main.ts
import first from "./first.bin" with { type: "file" };
const size: number = first;
console.log(size);

// FILE: first.bin
the first asset
