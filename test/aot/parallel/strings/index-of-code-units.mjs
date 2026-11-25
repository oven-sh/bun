// indexOf of one code unit on receivers that nothing is known of: short and long strings, ropes, parts of strings, wide strings, and what is no string.
const wide = "añł\u{1F600}b", long = "0123456789abcdefghijklmnop";
const strings = ["", "a", "ab", "123456789012345", "1234567890123456", long, wide, "\xff\xfe\x00a", long.slice(3, 9), long.substring(20), "x".repeat(14) + "y", "x".repeat(15) + "y"];
const sought = ["a", "b", "y", "5", "\x00", "\xff", "ł", "\ud83d", "", "ab", "p", "9", "x"];
function find(list, value) { let text = ""; for (let i = 0; i < list.length; i++) text += list[i].indexOf(value) + ","; return text; }
for (const value of sought) console.log(JSON.stringify(value), find(strings, value));
function rope(a, b) { return a + b; }
let text = "";
for (let i = 0; i < 20; i++) { const made = rope("k" + i, "=" + i); text += made.indexOf("=") + made.indexOf("k") + made.indexOf("z") + rope("", "q" + i).indexOf("q") + rope("ł" + i, "!").indexOf("!") + ";"; }
console.log(text);
const mixed = [[1, "a", 2], "banana", { indexOf(value) { return "own " + value; } }, new String("sea"), Object.assign(["a"], { indexOf: value => "laid " + value }), new Uint8Array([97, 98])];
console.log(find(mixed, "a"), find(mixed, "b"), find(mixed, 97));
for (const bad of [null, undefined, 5]) { try { find([bad], "a"); } catch (error) { console.log(error.constructor.name); } }
const keys = ["a", 1, null, undefined, true, { toString() { return "n"; } }, ["b"], 1n];
let all = ""; for (const key of keys) for (const s of ["banana1", "null", "undefined", "true"]) all += s.indexOf(key) + " "; console.log(all);
try { "a".indexOf(Symbol()); } catch (error) { console.log(error.constructor.name); }
let from = ""; for (let i = -2; i < 8; i++) from += "banana".indexOf("a", i) + " "; console.log(from);
