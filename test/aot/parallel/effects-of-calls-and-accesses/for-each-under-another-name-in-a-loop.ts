// forEach, whose rows all name one function of the library, is called under another name in a loop: its callback writes what the caller reads, and what the call gives comes round the loop
const each = Array.prototype.forEach;
let log = "";
function deed(from: number[], turns: number) { let last: unknown = "none"; for (let i = 0; i < turns; i++) { const before = log; last = each.call(from, (v: number) => { log = log + v; }); log = log + (before === log ? "=" : "+"); } return String(last) + " " + log; }
console.log(deed([1, 2], 0));
console.log(deed([1, 2], 1));
console.log(deed([1, 2], 3));
console.log(deed([], 2));
