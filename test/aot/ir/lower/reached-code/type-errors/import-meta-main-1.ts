// RUN: lower
// DIAGNOSTIC: TS2339 main.ts:2

// FILE: main.ts
import.meta.main && console.log((1 as number)
.nope);
export {};
