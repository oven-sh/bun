// Under: --aot-check=Validate: at the head of a turn the walk reads each variable of the file that the turn stores, to put it back where the turn begins again: a function of the file that names the variable runs only behind its first store, by link's own proof, and that vouches for the read
const parsed = text => JSON.parse(text);
let turns = 0, last = -1;
function reads(a, b) { for (let i = 1; i < a.length; i++) { turns += 2; b[i] = turns + a[i]; last = turns; } return b.length; }
let seen = reads(parsed("[1.25,2.25,3.25,4.25]"), parsed("[0.25,0.25,0.25,0.25]"));
console.log(String(seen), reads(parsed("[1.25,2.25,3.25,4.25]"), parsed("[0.25,0.25]")), String(turns), String(last));
