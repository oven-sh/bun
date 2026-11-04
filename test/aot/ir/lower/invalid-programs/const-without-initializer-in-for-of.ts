// RUN: lower
// DIAGNOSTIC: TS1155 1
// DIAGNOSTIC: TS2588 1

const v;
for (v of []) { }
