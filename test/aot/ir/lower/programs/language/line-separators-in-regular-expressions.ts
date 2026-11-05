// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1005 2
// DIAGNOSTIC: TS1109 2
// DIAGNOSTIC: TS1161 2
// DIAGNOSTIC: TS2304 2

// U+2028 stands in the first regular expression and U+2029, behind a backslash, in the second. Both end a line, and a regular expression ends on the line where it starts.
console.log(/a b/.source.length);
console.log(/a\ b/.source.length);
