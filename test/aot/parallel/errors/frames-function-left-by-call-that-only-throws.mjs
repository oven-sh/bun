// A function that leaves by a call of a function that only throws is gone from the stack when the error is made, whoever has called it: compiled code or native code.
function fail() { throw new Error("fail"); }
const arrow = () => fail();
function named() { return fail(); }
function show(label, run) {
  try { run(); } catch (error) { console.log(label, "|", String(error.stack).split("\n").slice(1, 4).map(line => /:(\d+:\d+)\)?$/.exec(line)?.[1]).join(" < ")); }
}
show("an arrow", () => { arrow(); });
show("a function", () => { named(); });
show("a method of a literal", () => { `${{ toString: () => fail() }}`; });
