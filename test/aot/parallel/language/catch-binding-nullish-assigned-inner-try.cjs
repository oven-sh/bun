// The binding of a catch clause is assigned by ??= in an inner try and read by a closure; each step throws in its turn.
const say = (...all) => console.log(...all);
let fuse = 0;
function step(v) { if (--fuse === 0) throw new Error("fuse at " + v); return v; }
function work() {
  let f0 = 0, f1 = 0;
  try { throw "b0"; } catch (b) {
    let peek = () => "none yet";
    try { f0 = step(1); b ??= step("b8"); peek = () => b; f1 = step(1); b ??= step("b9"); } catch (e) { say("caught", e.message, b, f0 + f1, peek()); }
    say("after", b, f0 + f1, peek());
  }
}
for (const k of [0, 1, 2, 3, 4, 5, 6, 12, 22, 23]) { fuse = k; say("fuse", k); try { work(); } catch (e) { say("escaped", e.message); } }
