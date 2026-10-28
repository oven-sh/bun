// A closure made inside a `try` reads a name that the same `try` stores only under a condition. Another closure stands in its place until then, and the handler and the code behind the statement call whichever it is.
const say = (...all) => console.log(...all);
let fuse = 0;
function step(value) {
  if (--fuse === 0) throw new Error("fuse at " + value);
  return value;
}

function storesIfNullish() {
  let first = 0, second = 0;
  try { throw "thrown"; } catch (caught) {
    let read = () => "none yet";
    try { first = step(1); caught ??= step("a"); read = () => caught; second = step(1); caught ??= step("b"); } catch (error) { say("caught", error.message, caught, first + second, read()); }
    say("after", caught, first + second, read());
  }
}

function storesIfFalsy() {
  let first = 0, second = 0;
  try { throw ""; } catch (caught) {
    let read = () => "none yet";
    try { first = step(1); caught ||= step("a"); read = () => caught; second = step(1); caught ||= step("b"); } catch (error) { say("caught", error.message, caught, first + second, read()); }
    say("after", caught, first + second, read());
  }
}

function storesIfTruthy() {
  let first = 0, second = 0;
  try { throw "thrown"; } catch (caught) {
    let read = () => "none yet";
    try { first = step(1); caught &&= step("a"); read = () => caught; second = step(1); caught &&= step(""); } catch (error) { say("caught", error.message, caught, first + second, read()); }
    say("after", caught, first + second, read());
  }
}

function storesInOneBranch(flag) {
  let first = 0, second = 0;
  {
    let held = "held";
    let read = () => "none yet";
    try { first = step(1); if (flag) held = step("a"); read = () => held; second = step(1); if (!flag) held = step("b"); } catch (error) { say("caught", error.message, held, first + second, read()); }
    say("after", held, first + second, read());
  }
}

function keepsTheClosure(kept) {
  let first = 0;
  try { throw "thrown"; } catch (caught) {
    let read = () => "none yet";
    try { first = step(1); caught ??= step("a"); read = () => caught + first; first = step(2); } catch (error) { kept.push(read); }
    kept.push(read);
  }
}

const kept = [];
for (const work of [storesIfNullish, storesIfFalsy, storesIfTruthy, () => storesInOneBranch(true), () => storesInOneBranch(false), () => keepsTheClosure(kept)]) {
  for (let count = 0; count < 6; count++) {
    fuse = count;
    say("fuse", count);
    try { work(); } catch (error) { say("escaped", error.message); }
  }
}
say(kept.map(read => read()).join(" "));
