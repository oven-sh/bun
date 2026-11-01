// `bun <file>` prints `typeof a !== "undefined"` as `typeof a < "u"`, and an error quotes that. The text was quoted as printed and the operator as written: `typeof a !== "u"`.
function tell(cases) {
  for (const [label, run] of Object.entries(cases)) {
    try {
      run();
      console.log(label + ": nothing thrown");
    } catch (error) {
      console.log(label + ": " + error.message);
    }
  }
}
function unlike() { const b = typeof window !== "undefined" ? window : null; return b.x; }
function like() { const b = typeof window === "undefined" ? null : window; return b.x; }
function loose() { const b = typeof window != "undefined" ? window : null; return b.x; }
function looseLike() { const b = typeof window == "undefined" ? null : window; return b.x; }
function inBrackets() { const b = (typeof window) !== ("undefined") ? window : null; return b.x; }
function argument(o) { return o.run(typeof window !== "undefined", typeof o === "undefined"); }
function otherText() { const b = typeof window !== "object" ? null : window; return b.x; }
function overLines(o) {
  return o.run(
    typeof window
      !== "undefined",
  );
}
tell({ unlike, like, loose, looseLike, inBrackets, argument: () => argument({}), otherText, overLines: () => overLines({}) });
