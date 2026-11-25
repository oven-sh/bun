const said = []; function note(line) { said.push(String(line)); }
const make = (tag) => JSON.parse(JSON.stringify({ tag }));
function* steps(script) {
  const before = make("before"), rare = make("rare"), atEnd = make("end");
  outer: for (let turn = 0; turn < script.length; turn++) {
    const a = make("a" + turn), b = make("b" + turn), c = make("c" + turn), how = script[turn]; let carried = make("k" + turn);
    try {
      if (how === 0) { yield a.tag; note(b.tag); yield before.tag; }
      else if (how === 1) { yield b.tag; note(a.tag + c.tag); }
      else if (how === 2) { for (const i of [0, 1]) { const inner = make("i" + i); yield inner.tag + a.tag; if (i === 1) continue outer; carried = make(carried.tag + inner.tag); yield carried.tag; } }
      else if (how === 3) { yield c.tag; throw make("thrown" + turn); }
      else if (how === 4) { yield rare.tag; break outer; }
      else { yield* [a.tag, b.tag]; }
      yield carried.tag + c.tag;
    } catch (error) { yield "caught " + (error.tag ?? error) + a.tag; note(b.tag); }
    finally { note("finally " + c.tag + before.tag); yield "f" + turn; note(a.tag); }
    yield "end of turn " + b.tag;
  }
  yield atEnd.tag; return before.tag;
}
function step(it, how, value) { try { const got = how === 0 ? it.next(value) : how === 1 ? it.throw(value) : it.return(value); note(got.done + " " + got.value); return got.done; } catch (error) { note("threw " + (error.tag ?? error)); return true; } }
function drive(script, before, how) { const it = steps(script); globalThis.held = it; for (let i = 0; i < before; i++) step(it, 0, i); step(it, how, "X"); for (let i = 0; i < 40 && !step(it, 0, i); i++) { } note("--"); }
for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 6; z++) for (let before = 0; before < 14; before++) for (let how = 0; how < 3; how++) drive([x, y, z], before, how);
let sum = 0; for (const line of said) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(said.length, sum); console.log(said.slice(0, 300).join("|"));
