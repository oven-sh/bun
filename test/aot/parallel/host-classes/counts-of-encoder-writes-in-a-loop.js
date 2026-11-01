// IR= 0 written asksOnlyTables
// IR@= 1 written builtinCallForm=Fields
// IR= 0 readAndWritten asksOnlyTables
// IR@= 1 readAndWritten builtinCallForm=Fields
// IR= 0 values asksOnlyTables
// IR@= 1 values builtinCallForm=Fields
// IR@= 1 parsed asksOnlyTables
const encoder = new TextEncoder();
let page = new Uint8Array(24);
function written(pieces) { let place = 0; for (let i = 0; i < pieces.length; i++) place += encoder.encodeInto(pieces[i], page.subarray(place)).written; return place; }
function readAndWritten(pieces) { let read = 0, place = 0; for (let i = 0; i < pieces.length; i++) { const counts = encoder.encodeInto(pieces[i], page); read += counts.read; place += counts.written; } return read + "/" + place; }
function values(object, names) { let all = ""; for (let i = 0; i < names.length; i++) all += Object.getOwnPropertyDescriptor(object, names[i]).value; return all; }
function parsed(texts) { let sum = 0; for (let i = 0; i < texts.length; i++) sum += JSON.parse(texts[i]).weight; return sum; }

const lines = [];
lines.push(written(["ab", "", "cé", "日本", "defgh"]) + " " + Array.from(page).join());
lines.push(written(["0123456789", "0123456789", "0123456789"]) + " " + Array.from(page).join());
lines.push(written([]) + " " + written(["😀", "\ud800"]));
lines.push(readAndWritten(["ab", "é", "x".repeat(30), "日".repeat(9)]));
const sparse = ["a", , "b"];
lines.push(written(sparse) + " " + readAndWritten(sparse));
page = new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }));
lines.push(written(["abc", "defgh", "ij"]) + " " + readAndWritten(["abcdefghij"]) + " " + Array.from(page).join());
lines.push(values({ a: 1, b: "two", get c() { return 3; } }, ["a", "b", "c"]));
try { values({ a: 1 }, ["a", "missing"]); } catch (error) { lines.push(error.name); }
lines.push(parsed(['{"weight":1}', '{"weight":2.5}', '{"other":0,"weight":4}']) + " " + parsed(["{}"]));
console.log(lines.join("\n"));
