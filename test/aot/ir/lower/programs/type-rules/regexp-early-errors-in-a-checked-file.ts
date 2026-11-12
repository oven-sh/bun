// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1507 1
// DIAGNOSTIC: TS1517 1
// DIAGNOSTIC: TS1532 1
// DIAGNOSTIC: TS1534 1

// TypeScript reports a regular expression literal that JavaScript rejects, and the build says no more of that literal. Of one that TypeScript is told to ignore it says what the engine says.
function unused() {
  return [
    /\1/u,
    /a**/,
    /(?<a>.)\k<b>/,
    /[b-a]/,
    // @ts-ignore
    /(?<c>.)(?<c>.)/,
  ];
}
console.log(typeof unused);
export {};
