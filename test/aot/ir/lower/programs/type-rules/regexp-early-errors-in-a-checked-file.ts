// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="unused"
// CHECK: NewRegExp pattern="\\1" regExpFlags=[Unicode]
// CHECK-NEXT: NewRegExp pattern="a**"
// CHECK-NEXT: NewRegExp pattern="(?<a>.)\\k<b>"
// CHECK-NEXT: NewRegExp pattern="[b-a]"
// CHECK-NEXT: NewRegExp pattern="(?<c>.)(?<c>.)"

// Whether a regular expression literal is valid is the engine's answer, in a checked file too, with a `@ts-ignore` above the literal or without: TypeScript's errors about a pattern (TS1507, TS1517, TS1532, TS1534) are not asked for.
// This driver has no engine to ask, so every literal is built.
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
