// a turn reads the state that the growing text had in front of the growth of the same turn
const seen: string[] = [];
function tell(text: string) { seen[seen.length] = text; }
function grow(n: number) { let s = ""; for (let i = 0; i < n; i++) { const before = s; s += "k" + i; tell(before); } return s; }
function measure(n: number) { let s = "<"; let out = ""; for (let i = 0; i < n; i++) { const before = s; s += "k" + i; out = out + before.length + ":" + before.slice(-2) + ","; } return out + s; }
console.log(JSON.stringify(grow(0)), seen.length);
console.log(grow(1), JSON.stringify(seen));
console.log(grow(4), JSON.stringify(seen));
console.log(measure(0), measure(1), measure(5));
for (let turn = 0; turn < 40; turn++) grow(turn % 5);
console.log(seen.length, JSON.stringify(seen.slice(-4)));
