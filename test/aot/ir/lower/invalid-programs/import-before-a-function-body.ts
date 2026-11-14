// RUN: lower
// DIAGNOSTIC: TS1003 2
// DIAGNOSTIC: TS1005 5
// DIAGNOSTIC: TS1141 1
// DIAGNOSTIC: TS1144 1

function f(d: number): number import { const a = d; return a }
f(1);
