// Functions that do the same may share code. That code returns to one address whoever called it, and runs in a frame that a stack trace hides, so the place
// that a message quotes is that of the call. The program is this small on purpose: with more in it the compiler shares something else.
"use strict";
const opaque = value => [value, 0][Number(process.argv.length > 100)];
const kept = [];
function attempt(label, run) {
  kept.push(run);
  try {
    console.log(label, "-> no throw", String(run()));
  } catch (error) {
    console.log(label, "->", error.message);
  }
}
const nothing = opaque(undefined), none = opaque(null);
const holder = opaque({ inner: null });
attempt("read of undefined", () => { nothing.name; });
attempt("read of null", () => { none.name; });
attempt("read member", () => { holder.inner.name; });
attempt("used", () => { const r = nothing.name; return r; });
console.log("kept", kept.filter(run => typeof run === "function").length);
