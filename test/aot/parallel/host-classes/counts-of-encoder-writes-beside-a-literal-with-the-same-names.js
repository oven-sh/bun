// IR= 0 written TypeTest .* testedType=L
// IR@= 1 written builtinCallForm=Fields
// IR= 0 readAndWritten TypeTest .* testedType=L
// IR@= 1 readAndWritten builtinCallForm=Fields
// IR@= 1 ofEither TypeTest .* testedType=L
const encoder = new TextEncoder();
const page = new Uint8Array(24);
const counting = { encodeInto(text, bytes) { return { read: text.length, written: Math.min(text.length, bytes.length) }; } };
function written(pieces) { let place = 0; for (let i = 0; i < pieces.length; i++) place += encoder.encodeInto(pieces[i], page.subarray(place)).written; return place; }
function readAndWritten(pieces) { let read = 0, place = 0; for (let i = 0; i < pieces.length; i++) { const counts = encoder.encodeInto(pieces[i], page); read += counts.read; place += counts.written; } return read + "/" + place; }
function ofEither(pieces) { let place = 0; for (let i = 0; i < pieces.length; i++) { const counts = i & 1 ? encoder.encodeInto(pieces[i], page) : counting.encodeInto(pieces[i], page); place += counts.written; } return place; }

const lines = [];
lines.push(written(["ab", "", "cé", "日本", "defgh"]) + " " + Array.from(page).join());
lines.push(written(["0123456789", "0123456789", "0123456789"]) + " " + written([]));
lines.push(readAndWritten(["ab", "é", "x".repeat(30), "日".repeat(9)]));
lines.push(ofEither(["ab", "é", "x".repeat(30), "日".repeat(9), ""]));
const counts = counting.encodeInto("abc", page);
lines.push(counts.read + "/" + counts.written);
console.log(lines.join("\n"));
