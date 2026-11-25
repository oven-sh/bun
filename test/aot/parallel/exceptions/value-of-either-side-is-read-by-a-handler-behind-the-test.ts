// a value that is a number on one side and a text on the other is tested for its type, and a handler behind the test reads it when the call under it throws
function fail(n: number): number { if (n % 2) throw new Error("odd"); return n; }
function subject(c: unknown, n: number) {
  const v = c ? n : "t" + n;
  if (typeof v === "number") {
    try { return "ran" + fail(v); } catch (e) { return "caught" + v; }
  }
  try { return "ran" + fail(v.length); } catch (e) { return "caught" + v; }
}
function deed(c: unknown, n: number) { return subject(c, n); }
console.log(deed(true, 1), deed(true, 2), deed(false, 1), deed(false, 10), deed(0, 100));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(i % 3, i).length;
console.log(String(lengths));
console.log(deed(JSON.parse("1"), JSON.parse("9")), deed(JSON.parse("0"), JSON.parse("9")));
