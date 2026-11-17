// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1547 1

// `using` directly in a `case` clause is an early error. Plain Bun does not lower `using`, and JavaScriptCore rejects it there: it needs a block.
switch (1) { case 1: using a = { [Symbol.dispose]() { console.log("disposed"); } }; console.log("body"); }
