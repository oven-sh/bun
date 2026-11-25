// `for (..) { if (flags[c]) s += extra[c]; }`: `extra` is read in some turns only, and is told apart in front of the loop: a list of numbers, a list, bytes, another view. What is none of these runs the loop as it would be walked without that guess, not the closed copy: `flags` keeps its typed turns until a turn comes to read `extra`. The data comes out of a text. `extra` is a record with keys like indexes, a text, a number, or an object whose index is answered by a getter (its calls are counted).
let asked = 0;
function f(flags, extra) { let s = 0; for (let c = 0; c < flags.length; c++) { if (flags[c]) s += extra[c]; } return s; }
const go = { f }[JSON.parse('"f"')];
const out = text => JSON.parse(text);
const byGetter = Object.defineProperty({}, 2, { get() { asked++; return 4.5; } });
for (let turn = 0; turn < 2; turn++) for (const extra of [out('{"2":1.5}'), 'abc', 7, byGetter, out('{}')]) console.log(go(out('[false,false,true]'), extra), asked);
