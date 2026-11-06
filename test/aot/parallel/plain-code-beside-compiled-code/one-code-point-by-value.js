const make = [String.fromCodePoint, String.fromCharCode][JSON.parse("0")];
let text = "";
for (const code of [65, 233, 0x4e2d, 0x1f600]) text += make(code);
console.log(text, text.length);
for (const bad of [-1, 0x110000]) { try { make(bad); } catch (error) { console.log(error.name, error.message); } }
