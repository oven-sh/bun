// a throw in the middle of a loop leaves the loop for a catch around it that ignores what is thrown: the counters are as the turn left them
function subject(n: number, at: number) { let i = 0; let sum = 0; try { for (; i < n; i++) { sum += i; if (i === at) throw new Error("stop"); sum += 100; } } catch { return "caught " + i + " " + sum; } return "done " + i + " " + sum; }
function nested(n: number, at: number) { let seen = ""; try { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { seen += i + "" + j + ","; if (i * n + j === at) throw new Error("stop"); } } } catch { return "caught " + seen; } return "done " + seen; }
function deed(n: number, at: number) { return subject(n, at) + " | " + nested(n, at); }
console.log(deed(0, 0));
console.log(deed(3, 0));
console.log(deed(3, 2));
console.log(deed(3, 7));
console.log(deed(3, 99));
