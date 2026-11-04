// the control: the name is a key of a Map, which makes no atom
const count = 20000;
const textOf = (i) => "identifier-number-" + (100000 + i);
const written = []; for (let i = 0; i < count; i++) written.push(textOf(i));
const wide = JSON.parse('["' + written.join('","') + '","Ā"]');
const seen = new Map(); for (const name of wide) seen.set(name, 0);
const narrow = []; for (let i = 0; i < count; i++) narrow.push(textOf(i));
const state = JSON.parse('{"out":"names:"}');
for (let i = 0; i < count; i++) { const name = narrow[i]; state.out += name; seen.set(name, seen.get(name) + 1); }
console.log(state.out.length, state.out.indexOf("\0"), state.out === "names:" + written.join(""));
