// The program lists the names of Object behind a copy of it, so it sees when Object got each member, and the first read of Object.entries stays an operation. Only the first one does anything,
// so the function that begins with it is still one that in the end only reads: its head stands in the loop, and no call is left there.
// IR-UNTIL InlineHeads
// IR+ InitializeBuiltin builtin=ObjectEntries\b
// IRM= 0 CallDirect v[0-9]+ function=f[0-9]+(?!.*isAfterInlinedHead)
// IRM= 1 CallDirect v[0-9]+ function=f[0-9]+.*isAfterInlinedHead
function byIndex(o) { const entries = Object.entries(o); let total = 0; for (let i = 0; i < entries.length; i++) total += entries[i][0].length + entries[i][1]; return total; }
const point = { x: 1, y: 2.5 };
let sum = 0; for (let n = 0; n < 1000; n++) { point.x = n & 7; sum += byIndex(point); }
Object.assign({}, Object);
console.log(sum, Reflect.ownKeys(Object).join());
