// `for (..) { if (flags[c]) s += extra[c]; }`: `extra` is read in some turns only, and is told apart in front of the loop: a list of numbers, a list, bytes, another view. What is none of these runs the loop as it would be walked without that guess, not the closed copy: `flags` keeps its typed turns until a turn comes to read `extra`. The data comes out of a text. `extra` is null or undefined: no turn reads it, and nothing throws; where a turn does, the read throws as in plain Bun, behind the turns before it.
function f(flags, extra) { let s = 0; for (let c = 0; c < flags.length; c++) { if (flags[c]) s += extra[c]; } return s; }
const go = { f }[JSON.parse('"f"')];
const out = text => JSON.parse(text);
for (const [flags, extra] of [['[false,false,false]', 'null'], ['[]', 'null'], ['[0,"",null]', 'null'], ['[false,false,true]', 'null'], ['[false,true]', '[1.5,2.5]']]) { try { console.log(go(out(flags), out(extra))); } catch (error) { console.log(error instanceof TypeError); } }
try { console.log(go(out('[false]')), go(out('[false,1]'))); } catch (error) { console.log(error instanceof TypeError); }
