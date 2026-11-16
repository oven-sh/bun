const count = 20000;
const textOf = (i) => "identifier-number-" + (100000 + i);
const written = [];
for (let i = 0; i < count; i++) written.push(textOf(i));
// One wide character makes the JSON text 16-bit, and every value longer than 16 characters a flat 16-bit string.
const wide = JSON.parse('["' + written.join('","') + '","Ā"]');
const seen = Object.create(null);
for (const name of wide) seen[name] = 0;                 // the names of these properties are 16-bit atoms now
const narrow = [];
for (let i = 0; i < count; i++) narrow.push(textOf(i));  // the same texts, 8-bit
const state = JSON.parse('{"out":"names:"}');
for (let i = 0; i < count; i++) {
  const name = narrow[i];
  state.out += name;   // joined as a part of an 8-bit rope
  seen[name] += 1;     // the key takes the characters of the name: 16 bits from here on
}
const out = state.out;
console.log(out.length, out.indexOf("\0"), out === "names:" + written.join(""));
