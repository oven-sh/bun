// Neither the handler nor the code behind it reads the variable but through the closure.
const say = (...all) => console.log(...all);
let fuse = 0;
function step(v) { if (--fuse === 0) throw new Error("fuse at " + v); return v; }
function work() {
  let f0 = 0, f1 = 0;
  { let b = "b0";
    let peek = () => "none yet";
    try { f0 = step(1); b ??= step("b8"); peek = () => b; f1 = step(1); b ??= step("b9"); } catch (e) { say("caught", e.message, f0 + f1, peek()); }
    say("after", f0 + f1, peek());
  }
}
for (const k of [0, 1, 2, 3, 4, 5, 6, 12, 22, 23]) { fuse = k; say("fuse", k); try { work(); } catch (e) { say("escaped", e.message); } }
