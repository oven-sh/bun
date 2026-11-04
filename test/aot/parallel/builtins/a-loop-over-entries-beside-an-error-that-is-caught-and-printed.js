// What a handler catches is a value that nobody knows, and printing it shows its keys. Such a value is a built-in object only if one went out of sight, and here none did:
// nobody sees in which order Object got its members. The read of Object.entries stays a constant, the function that reads it only reads, and it leaves no call in the loop.
// IR-UNTIL InlineHeads
// IR- InitializeBuiltin
// IRM= 0 CallDirect v[0-9]+ function=f[0-9]+(?!.*isAfterInlinedHead)
// IRM= 1 CallDirect v[0-9]+ function=f[0-9]+.*isAfterInlinedHead
function byIndex(o) { const entries = Object.entries(o); let total = 0; for (let i = 0; i < entries.length; i++) total += entries[i][0].length + entries[i][1]; return total; }
const point = { x: 1, y: 2.5 };
let sum = 0; for (let n = 0; n < 1000; n++) { point.x = n & 7; sum += byIndex(point); }
console.log(sum);
function fail(n) { if (n < 0) throw new RangeError("no " + n); return n; }
try { fail(-1); } catch (error) { console.log(error.message); }
