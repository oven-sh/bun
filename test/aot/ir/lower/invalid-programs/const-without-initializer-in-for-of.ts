// RUN: lower
// DIAGNOSTIC: TS1155 1
// DIAGNOSTIC: TS2588 1
// DIAGNOSTIC: TS7005 1

const v;
for (v of []) { }
