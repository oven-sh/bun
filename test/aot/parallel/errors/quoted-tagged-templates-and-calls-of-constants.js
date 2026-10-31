// A tagged template on what is no function is quoted with its template: "(near '...b`t`...')". And where a constant is called or constructed, its value stands in the quote
// with the arguments that are written: `const b = undefined; b(1, 2)` is '(void 0)(1, 2)'.
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
function tagged() { const b = null; return b`t`; }
function taggedUndefined() { const b = undefined; return b`t`; }
function taggedNumber() { const b = 5; return b`t`; }
function taggedParameter(b) { return b`t`; }
function taggedMember(o) { return o.tag`t${1}u`; }
function taggedElement(o, k) { return o[k]`t`; }
function taggedValues(b, c) { return b`t${c}u${`v${c}`}w`; }
function taggedLines(b) {
  return b`first
second`;
}
function untagged(o) { return o.run(`t`, `a${1}b`); }
function called() { const b = undefined; return b(); }
function calledWith() { const b = undefined; return b(1, 2); }
function calledNull() { const b = null; return b(); }
function calledNullWith() { const b = null; return b(1, 2); }
function calledTrue() { const b = true; return b(1); }
function calledText() { const b = "k"; return b(); }
function calledNegative() { const b = -1; return b(); }
function calledParameter(b) { return b(); }
function constructed() { const b = undefined; return new b(); }
function constructedBare() { const b = undefined; return new b; }
function constructedWith() { const b = undefined; return new b(1, 2); }
function constructedNull() { const b = null; return new b(); }
function constructedTrue() { const b = true; return new b(); }
function constructedNumber() { const b = 5; return new b(); }
function constructedText() { const b = "k"; return new b(1); }
function constructedParameter(b) { return new b(); }
function brackets(c) { const b = c ? {} : null; return (true && b).x; }
function comma(c) { const b = c ? {} : null; return (0x10, b).x; }
function twice(c) { const b = c ? {} : null; return ((b)).x; }
tell({
  tagged, taggedUndefined, taggedNumber, taggedParameter,
  taggedMember: () => taggedMember({}),
  taggedElement: () => taggedElement({}, "k"),
  taggedValues, taggedLines,
  untagged: () => untagged({}),
  called, calledWith, calledNull, calledNullWith, calledTrue, calledText, calledNegative, calledParameter,
  constructed, constructedBare, constructedWith, constructedNull, constructedTrue, constructedNumber, constructedText, constructedParameter,
  brackets: () => brackets(false),
  comma: () => comma(false),
  twice: () => twice(false),
});
