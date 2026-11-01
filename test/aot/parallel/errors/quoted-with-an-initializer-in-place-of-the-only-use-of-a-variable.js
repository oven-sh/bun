// `const r = lookup(x); return r.value;` runs as `return lookup(x).value;` under `bun <file>`, and an error quotes that. Its place is in the initializer.
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
function lookup(x) { return x; }
function constant(x) { const r = lookup(x); return r.value; }
function variable(x) { let r = lookup(x); return r.value; }
function usedTwice(x) { const r = lookup(x); return r.value + r.other; }
function called(x) { const r = lookup(x); return r.run(1); }
function inBrackets(x, y) { const r = x || y; return r.value; }
function conditionInBrackets(x, y) { const r = x ? x : y; return r.value; }
function object() { const r = { a: null }; return r.a.b; }
function member(x) { const r = x.inner; return r.value; }
function oneAfterAnother(x) { const a = lookup(x); const b = a; return b.value; }
function argument(x, o) { const r = x + 1; return o.run(r * 2, r); }
function onlyArgument(x, o) { const r = x + 1; return o.run(r * 2); }
function oneOperandPrinted(o) { return (true && o).x; }
function oneBranchPrinted(o) { return (1 ? o : null).x; }
function lastOfCommaPrinted(o) { return (0, o).x; }
function onLines(x) {
  const r = lookup(
    x,
  );
  return r.value;
}
function twoOnLines(x, y) {
  if (x) {
    const r = lookup(y);
    return r.first;
  }
  const r = lookup(x);
  return r.second;
}
class Reader {
  constructor(box) { this.box = box; }
  read() { const b = this.box; return b.value; }
  static read(box) { const b = lookup(box); return b.value; }
}
tell({
  constant: () => constant(null),
  variable: () => variable(null),
  usedTwice: () => usedTwice(null),
  called: () => called({}),
  inBrackets: () => inBrackets(null, null),
  conditionInBrackets: () => conditionInBrackets(null, null),
  object: () => object(),
  member: () => member({}),
  oneAfterAnother: () => oneAfterAnother(null),
  argument: () => argument(1, {}),
  onlyArgument: () => onlyArgument(1, {}),
  oneOperandPrinted: () => oneOperandPrinted(null),
  oneBranchPrinted: () => oneBranchPrinted(null),
  lastOfCommaPrinted: () => lastOfCommaPrinted(null),
  onLines: () => onLines(null),
  "two on lines, the first": () => twoOnLines(1, null),
  "two on lines, the second": () => twoOnLines(null, null),
  method: () => new Reader(null).read(),
  staticMethod: () => Reader.read(null),
});
