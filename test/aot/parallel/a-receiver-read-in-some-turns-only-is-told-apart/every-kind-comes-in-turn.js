// `for (..) { if (flags[c]) s += extra[c]; }`: `extra` is read in some turns only, and is told apart in front of the loop: a list of numbers, a list, bytes, another view. What is none of these runs the loop as it would be walked without that guess, not the closed copy: `flags` keeps its typed turns until a turn comes to read `extra`. The data comes out of a text. One kind after another comes, those that are told apart and those that are not.
function f(flags, extra) { let s = 0; for (let c = 0; c < flags.length; c++) { if (flags[c]) s += extra[c]; } return s; }
const go = { f }[JSON.parse('"f"')];
const out = text => JSON.parse(text);
for (let turn = 0; turn < 2; turn++) for (const extra of [out('[0.5,1.5,2.5]'), out('[1,2,3]'), out('["a",1,null]'), new Uint8Array([7, 8, 9]), Buffer.from([1, 2, 3]), new Float64Array([0.25, 0.5, 0.75]), out('{"0":1,"2":2}'), 'xyz', out('[1,null]')]) console.log(go(out('[true,false,true]'), extra));
