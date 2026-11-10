const rounds = Number(process.argv[2] ?? 3);
const text = JSON.parse('"abcd"');
const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const floats = new Float64Array([0.5, 1.5, 2.5, 3.5]);
const letters = JSON.parse('"wxyz"');
const record = JSON.parse('{"0": 7, "1": 8, "2": 9}');
const holes = [0.5, , 2.5, 3.5];
function overBytes(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += bytes[i]; return total; }
function overFloats(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += floats[i]; return total; }
function overLetters(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += letters[i]; return total; }
function overRecord(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += record[i]; return total; }
function overHoles(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += holes[i]; return total; }
const byName = { overBytes, overFloats, overLetters, overRecord, overHoles };
const said = [];
for (const name of JSON.parse('["overBytes", "overFloats", "overLetters", "overRecord", "overHoles"]')) {
  for (let round = 0; round < rounds; round++) said.push(String(byName[name](round)));
}
console.log(said.join(" "));
