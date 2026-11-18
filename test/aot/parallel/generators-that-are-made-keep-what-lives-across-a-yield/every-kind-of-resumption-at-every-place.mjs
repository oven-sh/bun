const said = []; function note(line) { said.push(String(line)); }
const make = (tag) => JSON.parse(JSON.stringify({ tag }));
function* inner(from) { const own = make("own" + from); try { const got = yield from; note(got + own.tag); yield from + 1; } finally { note("inner left " + own.tag); } return own.tag; }
function* steps(limit) { const atCatch = make("catch"), atFinally = make("finally"), atLast = make("last"), behind = make("behind"); let carried = make("c");
  try { try { for (let i = 0; i < limit; i++) { const turn = make("t" + i); yield turn.tag; carried = make(carried.tag + i); yield carried.tag + turn.tag; }
      note(yield* inner(limit)); yield behind.tag; } catch (error) { yield atCatch.tag + error + carried.tag; }
    yield "after " + carried.tag; } finally { note(atFinally.tag + carried.tag); yield atLast.tag; note("left " + atFinally.tag); } }
function step(it, how, value) { try { const got = how === 0 ? it.next(value) : how === 1 ? it.throw(value) : it.return(value); note(got.done + " " + got.value); return got.done; } catch (error) { note("threw " + error); return true; } }
function drive(before, how) { const it = steps(2); globalThis.held = it; for (let i = 0; i < before; i++) step(it, 0, i); step(it, how, "X"); for (let i = 0; i < 12 && !step(it, 0, i); i++) { } note("--"); }
for (let round = 0; round < 7; round++) for (let before = 0; before < 11; before++) for (let how = 0; how < 3; how++) drive(before, how);
let sum = 0; for (const line of said) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(said.length, sum); console.log(said.slice(0, 560).join("|"));
