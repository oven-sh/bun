// the `finally` round the yield of a generator throws while the loop over it is left: by break its error is thrown on, by a throw it is dropped
function* guarded() { try { yield 1; yield 2; } finally { console.log("finally"); throw new RangeError("of the finally"); } }
function leaves(how) { try { for (const value of guarded()) { if (how === "break") break; if (how === "throw") throw new TypeError("of the turn"); } } catch (error) { return error.name + " " + error.message; } return "nothing"; }
function deed() { return leaves("throw"); }
console.log(leaves("break"));
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
console.log(leaves("end"));
