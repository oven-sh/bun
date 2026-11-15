// answers: without-library
// # Members are read, stored to, called, read by key, taken apart and chained on records, null, undefined, a number, a text and an object with a getter. Where the language throws, what stands to the right has run or has not, as the language says.
// # At the end the shell runs the same text itself: every answer is the same.
// # Where a guess about a list fails, `for of` goes by the protocol and calls `next` of the iterators of arrays, which is a function of the library. So the text brings that function.
// # Without mechanisms the program runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 51 of 51 of 51
// # CHECK-NEXT: exited with 0
let said = "";
function name(error) { return error instanceof TypeError ? "TypeError" : String(error); }
function reads(box) { try { return box.value; } catch (error) { return name(error); } }
function readsTwice(box) { try { const first = box.value; return first + box.more; } catch (error) { return name(error); } }
function stores(box) { try { box.value = (said += "v", 1); return box.value; } catch (error) { return name(error); } }
function calls(box) { try { return box.run((said += "a", 1)); } catch (error) { return name(error); } }
function byKey(box, key) { try { return box[(said += "k", key)]; } catch (error) { return name(error); } }
function takesApart(box) { try { const { value, more = 5 } = box; return value + ":" + more; } catch (error) { return name(error); } }
function chained(box) { return box?.value?.length + ":" + box?.run?.(2); }
const boxes = [{ value: "ab", more: 1, run(by) { return by * 2; } }, { value: 3 }, null, undefined, 0, "text", { get value() { said += "g"; return null; } }];
for (const box of boxes) { report(reads(box)); report(readsTwice(box)); report(stores(box)); report(calls(box)); report(byKey(box, "value")); report(takesApart(box)); report(chained(box)); }
report(said);
report("end");
