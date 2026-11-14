// RUN: lower
// DIAGNOSTIC: TS1155 2
// DIAGNOSTIC: TS7005 1

function f() { using x; }
async function g() { await using y; }
f();
