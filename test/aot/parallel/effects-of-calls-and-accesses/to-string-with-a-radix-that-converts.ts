// toString of a number is handed a radix that is an object, whose valueOf runs, gives another radix than ten and writes what the caller reads
let log = "";
function deed(n: number, radix: any) { const before = log; const text = n.toString(radix); return text + " " + before + "|" + log; }
console.log(deed(255, 10));
console.log(deed(255, undefined));
console.log(deed(255, { valueOf() { log = log + "v"; return 16; } }));
try { console.log(deed(255, 1)); } catch (e) { console.log((e as Error).name); }
let all = "";
for (let i = 0; i < 4; i++) all += deed(i + 0.5, i % 2 ? 2 : 10) + ";";
console.log(all);
