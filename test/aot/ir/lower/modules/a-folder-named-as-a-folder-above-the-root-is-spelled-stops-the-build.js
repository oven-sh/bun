// one/two, the folder above that of the entry point, is spelled `_.._` below one. A real folder of that name lies beside it, so one/_.._/a.js and one/two/a.js would have one path in the executable.
// The build names the two files.
// DIAGNOSTIC: TS100085 1
// ENTRY: one/two/app/main.js
// CWD: one/two/app
// RUN: link

// FILE: one/two/app/main.js
import "../../_.._/a.js";
import "../a.js";

// FILE: one/_.._/a.js
export {};

// FILE: one/two/a.js
export {};
