const bytes = new Uint8Array([5, 6, 7, 8]);
const floats = new Float64Array([0.5, 1.5]);
Object.preventExtensions(bytes); Object.preventExtensions(floats);
function total(): number { let sum = 0; for (let at = 0; at < bytes.length; at++) sum += bytes[at]; for (const x of floats) sum += x; return sum; }
let all = "";
for (let round = 0; round < 3; round++) { bytes[round] = round * 10; floats[round % 2] += 1; all += total() + "," + bytes.indexOf(7) + "," + bytes.join("") + "," + floats.length + ";"; }
console.log(all);
