// RUN: lower
// DIAGNOSTIC: TS1005 1

(0, eval)("globalThis.seen = value => value");
function open() {
  console.log(1);
