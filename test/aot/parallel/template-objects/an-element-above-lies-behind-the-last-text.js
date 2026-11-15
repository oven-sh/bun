// Code tries to give Array.prototype an element at the index behind the last text of a template object, which a tag reads. A compiled executable refuses the store, plain Bun takes it: either way the tag reads what is there.
function beyond(strings) { return strings[2]; }
function rawBeyond(strings) { return strings.raw[2]; }
function within(strings) { return strings[1] + strings.raw[1] + strings.length; }
function run(expected) { const a = beyond`a${1}b`; const b = rawBeyond`a${1}b`; const c = within`a${1}\t`; return String(a === expected) + " " + String(b === expected) + " " + c; }

function deed() {
  try { Array.prototype[2] = "above"; return "above"; } catch (error) { return undefined; }
}
console.log(run(undefined));
let said = "";
for (let i = 0; i < 200; i++) said = run(undefined);
console.log(said);
const expected = deed();
console.log(run(expected));
for (let i = 0; i < 200; i++) said = run(expected);
console.log(said);
