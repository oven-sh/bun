// the body of a generator that a loop alone has throws in front of its first yield, under a try of the caller and under none
function* fails(when, limit) { console.log("body " + when); if (when === 0) throw new RangeError("in front of the first yield"); for (let i = 0; i < limit; i++) { if (i === when) throw new RangeError("behind yield " + i); yield i; } }
function sum(when, limit) { let total = 0; try { for (const value of fails(when, limit)) total += value + 1; } catch (error) { return total + " " + error.name + " " + error.message; } finally { console.log("left"); } return String(total); }
function deed() { return sum(0, 3); }
console.log(sum(-1, 3));
console.log(deed());
for (let i = 0; i < 3; i++) console.log(sum(i, 3));
console.log(deed());
console.log(sum(-1, 0));
