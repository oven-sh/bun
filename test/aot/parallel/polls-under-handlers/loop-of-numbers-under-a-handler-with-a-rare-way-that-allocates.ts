// a loop of plain numbers stands under a handler from outside. On a rare way a turn allocates, calls and throws: what is thrown comes to the handler with the sums as that turn left them
function subject(n: number, rareAt: number, throwsAt: number) { let sum = 0; const made: string[] = []; try { for (let i = 0; i < n; i++) { sum += i; if (i === rareAt) made.push("rare" + i); if (i === throwsAt) throw new RangeError("at" + i); } } catch (e) { return (e as Error).message + " " + sum + " " + made.join(); } return "done " + sum + " " + made.join(); }
function deed(n: number, rareAt: number, throwsAt: number) { return subject(n, rareAt, throwsAt); }
console.log(deed(0, 0, 0));
console.log(deed(10, -1, -1));
console.log(deed(10, 3, -1));
console.log(deed(10, 3, 5));
console.log(deed(10, 5, 5));
console.log(deed(100000, 99999, -1));
let text = "";
for (let i = 0; i < 4; i++) text += deed(6, i, i + 1) + ";";
console.log(text);
