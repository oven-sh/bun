// RUN: lower
// DIAGNOSTIC: TS1155 2

function f() { using x; }
async function g() { await using y; }
f();
