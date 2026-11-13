// toLowerCase() and toUpperCase() of every Latin-1 character by itself, of a few beyond, and of short strings.
const out = [];
const lower = value => value.toLowerCase(), upper = value => value.toUpperCase();
const texts = [];
for (let code = 0; code < 0x180; code++) texts.push(String.fromCharCode(code));
for (const text of ["", "A", "a", "Z", "z", "@", "[", "`", "{", "ab", "aB", "Ab", "zZz", "0aA", "ß", "ÿ", "İ", "İ̇", "ǅ", "Σ", "ΑΣ", "𐐀", "abcdefgh", "abcdefgH", "Abcdefghi", "x".repeat(40), "x".repeat(39) + "Y"]) texts.push(text);
const joined = texts.join("");
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < texts.length; i++) out.push(lower(texts[i]), upper(texts[i]), lower(texts[i]) === texts[i], upper(texts[i]) === texts[i]);
  for (let i = 0; i + 1 < joined.length; i += 7) out.push(lower(joined[i]) + upper(joined.charAt(i)) + lower(joined.substring(i, i + 1)) + upper(joined.slice(i, i + 2)));
}
for (const value of [new String("Q"), { toLowerCase: () => "own", toUpperCase: () => "OWN" }, Object.assign(Object("r"), { toLowerCase: () => "R" })]) out.push(lower(value), upper(value));
for (const value of [null, undefined, 1, Symbol.iterator, {}]) { try { out.push(lower(value)); } catch (error) { out.push(error.name); } }
let hash = 0;
for (const text of out) for (let i = 0; i < String(text).length; i++) hash = (Math.imul(hash, 31) + String(text).charCodeAt(i)) | 0;
console.log(out.length, hash, JSON.stringify(out.slice(0, 60)), JSON.stringify(out.slice(-12)));
